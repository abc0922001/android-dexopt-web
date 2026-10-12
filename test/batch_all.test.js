import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdbController } from '../src/adb-controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('index.html contains -f -a batch compilation options and command preview', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  assert.ok(html.includes('name="batchMethod"'), 'index.html must have batchMethod radio inputs');
  assert.ok(html.includes('value="all_direct"'), 'index.html must have all_direct option for -f -a');
  assert.ok(html.includes('value="sequential"'), 'index.html must have sequential option');
  assert.ok(html.includes('id="batchCommandPreview"'), 'index.html must have #batchCommandPreview element');
  assert.ok(html.includes('id="batchDirectNotice"'), 'index.html must have #batchDirectNotice element');
  assert.ok(html.includes('id="batchScopeContainer"'), 'index.html must have #batchScopeContainer element');
  assert.ok(html.includes('id="btnConfirmBatchText"'), 'index.html must have #btnConfirmBatchText element');
});

test('adb-controller.js compileAll executes cmd package compile with -m <mode> -f -a', async () => {
  const adb = new AdbController();
  const executedCommands = [];

  // Mock exec method
  adb.exec = async (cmdArray, options) => {
    executedCommands.push({ cmd: cmdArray, options });
    options?.onOutput?.('Optimizing: com.example.app\n');
    return { stdout: 'Success', stderr: '', exitCode: 0 };
  };

  let outputReceived = '';
  const resSpeed = await adb.compileAll('speed', {
    onOutput: (chunk) => {
      outputReceived += chunk;
    },
  });

  assert.strictEqual(executedCommands.length, 1);
  assert.deepStrictEqual(executedCommands[0].cmd, ['cmd', 'package', 'compile', '-m', 'speed', '-f', '-a']);
  assert.strictEqual(resSpeed.exitCode, 0);
  assert.ok(outputReceived.includes('com.example.app'));

  // Test speed-profile mode
  executedCommands.length = 0;
  const resProfile = await adb.compileAll('speed-profile');
  assert.strictEqual(executedCommands.length, 1);
  assert.deepStrictEqual(executedCommands[0].cmd, ['cmd', 'package', 'compile', '-m', 'speed-profile', '-f', '-a']);
  assert.strictEqual(resProfile.exitCode, 0);
});

test('adb-controller.js compileAll falls back to pm compile when cmd package fails', async () => {
  const adb = new AdbController();
  const executedCommands = [];

  adb.exec = async (cmdArray) => {
    executedCommands.push(cmdArray);
    if (cmdArray[0] === 'cmd') {
      throw new Error('cmd: not found');
    }
    return { stdout: 'Success via pm', stderr: '', exitCode: 0 };
  };

  const res = await adb.compileAll('speed');
  assert.strictEqual(executedCommands.length, 2);
  assert.deepStrictEqual(executedCommands[0], ['cmd', 'package', 'compile', '-m', 'speed', '-f', '-a']);
  assert.deepStrictEqual(executedCommands[1], ['pm', 'compile', '-m', 'speed', '-f', '-a']);
  assert.strictEqual(res.stdout, 'Success via pm');
});

test('adb-controller.js runs mock compile in demo mode and supports cancellation', async () => {
  const adb = new AdbController();
  adb.isDemoMode = true;

  const logs = [];
  const compilePromise = adb.compileAll('speed-profile', {
    onOutput: (chunk) => logs.push(chunk),
  });

  // Cancel almost immediately
  setTimeout(() => {
    adb.cancelBatchCompile();
  }, 100);

  const res = await compilePromise;
  assert.ok(logs.length > 0, 'Demo compile must produce output chunks');
  assert.ok(res.exitCode === 0 || res.exitCode === 130, 'Exit code should be 0 or 130 on cancel');
});

test('main.js handles both all_direct and sequential options with preview and state sync', () => {
  const mainCode = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');
  assert.ok(mainCode.includes('batchMethod'), 'main.js must track batchMethod state');
  assert.ok(mainCode.includes('updateBatchModalPreview'), 'main.js must define updateBatchModalPreview');
  assert.ok(mainCode.includes('compileAll(targetMode'), 'main.js must call compileAll when batchMethod is all_direct');
  assert.ok(mainCode.includes('cmd package compile -m ${targetMode} -f -a'), 'main.js must format preview command');
  assert.ok(mainCode.includes('cancelBatchCompile'), 'main.js must support cancelBatchCompile');
});
