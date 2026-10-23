import test from 'node:test';
import assert from 'node:assert/strict';
import { AdbController, buildCompileCommand } from '../src/adb-controller.js';

test('buildCompileCommand supports -m everything', () => {
  const cmd = buildCompileCommand('com.example.app', { filter: 'everything' });
  assert.deepStrictEqual(cmd, ['cmd', 'package', 'compile', '-m', 'everything', '-f', 'com.example.app']);
});

test('buildCompileCommand supports -r compiler reason (hardware scheduling)', () => {
  const cmdDefault = buildCompileCommand('com.example.app', { filter: 'speed' });
  assert.deepStrictEqual(cmdDefault, ['cmd', 'package', 'compile', '-m', 'speed', '-f', 'com.example.app']);

  const cmdCmdline = buildCompileCommand('com.example.app', { filter: 'speed', compilerReason: 'cmdline' });
  assert.deepStrictEqual(cmdCmdline, ['cmd', 'package', 'compile', '-m', 'speed', '-r', 'cmdline', '-f', 'com.example.app']);

  const cmdBg = buildCompileCommand('com.example.app', { filter: 'speed-profile', compilerReason: 'bg-dexopt' });
  assert.deepStrictEqual(cmdBg, ['cmd', 'package', 'compile', '-m', 'speed-profile', '-r', 'bg-dexopt', '-f', 'com.example.app']);
});

test('buildCompileCommand supports --check-prof false', () => {
  const cmd = buildCompileCommand('com.example.app', { filter: 'speed-profile', checkProfFalse: true });
  assert.deepStrictEqual(cmd, ['cmd', 'package', 'compile', '-m', 'speed-profile', '-f', '--check-prof', 'false', 'com.example.app']);
});

test('buildCompileCommand supports -c clear profile', () => {
  const cmd = buildCompileCommand('com.example.app', { filter: 'verify', clearProfile: true, force: false });
  assert.deepStrictEqual(cmd, ['cmd', 'package', 'compile', '-c', '-m', 'verify', 'com.example.app']);
});

test('buildCompileCommand supports --split modular compilation', () => {
  const cmd = buildCompileCommand('com.example.app', { filter: 'speed', splitName: 'split_camera' });
  assert.deepStrictEqual(cmd, ['cmd', 'package', 'compile', '-m', 'speed', '-f', '--split', 'split_camera', 'com.example.app']);

  // Also supports options.split alias
  const cmdAlias = buildCompileCommand('com.example.app', { filter: 'speed', split: 'split_payment' });
  assert.deepStrictEqual(cmdAlias, ['cmd', 'package', 'compile', '-m', 'speed', '-f', '--split', 'split_payment', 'com.example.app']);
});

test('buildCompileCommand supports --secondary-dex', () => {
  const cmd = buildCompileCommand('com.example.app', { filter: 'speed', isSecondary: true });
  assert.deepStrictEqual(cmd, ['cmd', 'package', 'compile', '-m', 'speed', '-f', '--secondary-dex', 'com.example.app']);
});

test('buildCompileCommand adapts command for Android 14+ (SDK 34+) ART Service', () => {
  const cmdArt = buildCompileCommand('com.example.app', { filter: 'speed', compilerReason: 'cmdline' }, 34);
  assert.deepStrictEqual(cmdArt, ['cmd', 'art', 'compile', '-m', 'speed', '-r', 'cmdline', '-f', 'com.example.app']);

  const cmdLegacy = buildCompileCommand('com.example.app', { filter: 'speed', compilerReason: 'cmdline' }, 33);
  assert.deepStrictEqual(cmdLegacy, ['cmd', 'package', 'compile', '-m', 'speed', '-r', 'cmdline', '-f', 'com.example.app']);
});

test('buildCompileCommand defends against command injection attacks', () => {
  assert.throws(() => {
    buildCompileCommand('com.example.app; rm -rf /', { filter: 'speed' });
  }, /無效的套件名稱/);

  assert.throws(() => {
    buildCompileCommand('com.example.app', { filter: 'speed', compilerReason: 'cmdline | reboot' });
  }, /無效的編譯原因/);

  assert.throws(() => {
    buildCompileCommand('com.example.app', { filter: 'speed', splitName: 'split_foo && cat /etc/passwd' });
  }, /無效的 Split 模組名稱/);

  assert.throws(() => {
    buildCompileCommand('com.example.app', { filter: 'speed; sleep 10' });
  }, /無效的編譯模式/);
});

test('AdbController in demo mode supports Root expert tuning operations', async () => {
  const controller = new AdbController();
  await controller.enableDemoMode();

  // Root access check
  const rootRes = await controller.checkRootAccess();
  assert.strictEqual(rootRes.hasRoot, true);
  assert.strictEqual(rootRes.uid, 0);

  // Read system properties
  const props = await controller.getDexoptSystemProps();
  assert.ok(props.threads);
  assert.ok(props.cpuSet);

  // Apply custom dex2oat props
  await controller.applyCustomDex2oatProps({
    threads: 8,
    cpuSet: '0-7',
    extraFlags: '--inline-max-code-units=128 --no-generate-mini-debug-info',
  });

  // Restore dex2oat props
  const restored = await controller.restoreDex2oatProps();
  assert.strictEqual(restored, true);
});

test('AdbController validates custom dex2oat props strictly', async () => {
  const controller = new AdbController();
  await controller.enableDemoMode();

  await assert.rejects(async () => {
    await controller.applyCustomDex2oatProps({ threads: 64 });
  }, /無效的執行緒數量/);

  await assert.rejects(async () => {
    await controller.applyCustomDex2oatProps({ cpuSet: '0-7; reboot' });
  }, /無效的 CPU 親和力遮罩/);

  await assert.rejects(async () => {
    await controller.applyCustomDex2oatProps({ extraFlags: '--inline-max-code-units=128; rm -rf /' });
  }, /額外旗標包含不安全字元/);
});
