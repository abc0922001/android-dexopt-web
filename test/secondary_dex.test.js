import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdbController } from '../src/adb-controller.js';
import { parseDumpsysPackageStream } from '../src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('adbController.compileApp automatically compiles secondary DEX when optimizable items exist (Issue #9 Problem 2)', async () => {
  const adb = new AdbController();
  const executedCommands = [];

  adb.exec = async (cmdArray, options) => {
    executedCommands.push({ cmd: cmdArray, options });
    if (cmdArray[0] === 'dumpsys') {
      return {
        stdout: `Dexopt state:
  [jp.naver.line.android]
    path: /data/app/base.apk
      arm64: [status=speed] [reason=cmdline] [primary-abi]
`,
        stderr: '',
        exitCode: 0,
      };
    }
    return { stdout: 'Success', stderr: '', exitCode: 0 };
  };

  const appInfoWithSecondaryDex = {
    packageName: 'jp.naver.line.android',
    hasSecondaryDex: true,
    hasOptimizableSecondaryDex: true,
    secondaryDexSummary: {
      total: 3,
      restrictedCount: 1,
      optimizableCount: 2,
      compiledCount: 0,
    },
  };

  // 1. Force = true (default)
  await adb.compileApp('jp.naver.line.android', 'speed', {
    appInfo: appInfoWithSecondaryDex,
    force: true,
    autoSecondaryDex: true,
  });

  // Must execute:
  // 1) base compile: ['cmd', 'package', 'compile', '-m', 'speed', '-f', 'jp.naver.line.android']
  // 2) secondary dex compile: ['cmd', 'package', 'compile', '-m', 'speed', '-f', '--secondary-dex', 'jp.naver.line.android']
  // 3) dumpsys query: ['dumpsys', 'package', 'jp.naver.line.android']
  assert.strictEqual(executedCommands.length, 3);
  assert.deepStrictEqual(executedCommands[0].cmd, ['cmd', 'package', 'compile', '-m', 'speed', '-f', 'jp.naver.line.android']);
  assert.deepStrictEqual(executedCommands[1].cmd, ['cmd', 'package', 'compile', '-m', 'speed', '-f', '--secondary-dex', 'jp.naver.line.android']);
  assert.deepStrictEqual(executedCommands[2].cmd, ['dumpsys', 'package', 'jp.naver.line.android']);

  // 2. Force = false (Fast AOT mode)
  executedCommands.length = 0;
  await adb.compileApp('jp.naver.line.android', 'speed-profile', {
    appInfo: appInfoWithSecondaryDex,
    force: false,
    autoSecondaryDex: true,
    skipQueryStatus: true,
  });

  assert.strictEqual(executedCommands.length, 2);
  assert.deepStrictEqual(executedCommands[0].cmd, ['cmd', 'package', 'compile', '-m', 'speed-profile', 'jp.naver.line.android']);
  assert.deepStrictEqual(executedCommands[1].cmd, ['cmd', 'package', 'compile', '-m', 'speed-profile', '--secondary-dex', 'jp.naver.line.android']);

  // 3. autoSecondaryDex = false -> should NOT run secondary-dex command
  executedCommands.length = 0;
  await adb.compileApp('jp.naver.line.android', 'speed', {
    appInfo: appInfoWithSecondaryDex,
    force: true,
    autoSecondaryDex: false,
    skipQueryStatus: true,
  });

  assert.strictEqual(executedCommands.length, 1);
  assert.deepStrictEqual(executedCommands[0].cmd, ['cmd', 'package', 'compile', '-m', 'speed', '-f', 'jp.naver.line.android']);

  // 4. appInfo has NO optimizable secondary dex (e.g., restricted only)
  executedCommands.length = 0;
  const appInfoRestrictedOnly = {
    packageName: 'jp.naver.line.android',
    hasSecondaryDex: true,
    hasOptimizableSecondaryDex: false,
    secondaryDexSummary: {
      total: 1,
      restrictedCount: 1,
      optimizableCount: 0,
      compiledCount: 0,
    },
  };
  await adb.compileApp('jp.naver.line.android', 'speed', {
    appInfo: appInfoRestrictedOnly,
    force: true,
    autoSecondaryDex: true,
    skipQueryStatus: true,
  });

  assert.strictEqual(executedCommands.length, 1);
  assert.deepStrictEqual(executedCommands[0].cmd, ['cmd', 'package', 'compile', '-m', 'speed', '-f', 'jp.naver.line.android']);
});

test('AdbController in demo mode simulates secondary DEX compilation and state transitions', async () => {
  const adb = new AdbController();
  await adb.enableDemoMode();

  const appInfo = {
    packageName: 'jp.naver.line.android',
    hasSecondaryDex: true,
    hasOptimizableSecondaryDex: true,
    secondaryDex: [
      { path: '/data/user/0/line/app_pccache/1/pcam.jar', status: 'verify', isOptimizable: true },
      { path: '/data/user/0/line/app_pccache/2/pcam.jar (removed)', status: 'unknown', isRemoved: true, isUnsupportedContext: true, isOptimizable: false },
    ],
    secondaryDexSummary: {
      total: 2,
      restrictedCount: 1,
      optimizableCount: 1,
      compiledCount: 0,
    },
  };

  let outputText = '';
  const result = await adb.compileApp('jp.naver.line.android', 'speed', {
    appInfo,
    onOutput: (chunk) => {
      outputText += chunk;
    },
  });

  assert.strictEqual(result.status, 'speed');
  assert.ok(outputText.includes('--secondary-dex'));
  assert.strictEqual(result.hasOptimizableSecondaryDex, false);
  assert.strictEqual(result.secondaryDexSummary.optimizableCount, 0);
  assert.strictEqual(result.secondaryDex[0].status, 'speed');
  assert.strictEqual(result.secondaryDex[1].status, 'unknown'); // restricted item retains status
});

test('main.js contains UI badges and tooltips for Split APKs and Secondary DEX', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  // Badge logic for Split APKs
  assert.ok(mainJs.includes('splitBadge'), 'main.js should define splitBadge');
  assert.ok(mainJs.includes('split:'), 'main.js should include split: badge label');

  // Badge logic for Secondary DEX
  assert.ok(mainJs.includes('secondaryDexBadge'), 'main.js should define secondaryDexBadge');
  assert.ok(mainJs.includes('sec-dex:'), 'main.js should include sec-dex: badge label');
  assert.ok(mainJs.includes('受限'), 'main.js should handle restricted secondary dex label');
  assert.ok(mainJs.includes('待最佳化'), 'main.js should handle unoptimized secondary dex label');

  // Queue integration: passing appInfo to compileApp
  assert.ok(mainJs.includes('appInfo'), 'main.js queue processing should pass appInfo to compileApp');
});
