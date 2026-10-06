import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdbController } from '../src/adb-controller.js';
import { classifyApps } from '../src/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('index.html contains Profile check UI elements (Issue #5)', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

  assert.ok(html.includes('id="btnBatchCheckProfile"'), 'index.html must have btnBatchCheckProfile');
  assert.ok(html.includes('id="checkProfileConfirmModal"'), 'index.html must have checkProfileConfirmModal');
  assert.ok(html.includes('id="btnCancelCheckProfileModal"'), 'index.html must have btnCancelCheckProfileModal');
  assert.ok(html.includes('id="btnConfirmCheckProfileModal"'), 'index.html must have btnConfirmCheckProfileModal');
  assert.ok(html.includes('name="checkProfileScope"'), 'index.html must have checkProfileScope radio inputs');
  assert.ok(html.includes('id="checkProfileScopeFrequentlyUsedCount"'), 'index.html must have checkProfileScopeFrequentlyUsedCount');
  assert.ok(html.includes('id="checkProfileScopeUserCount"'), 'index.html must have checkProfileScopeUserCount');
  assert.ok(html.includes('id="checkProfileScopeAllCount"'), 'index.html must have checkProfileScopeAllCount');
});

test('adb-controller.js defines checkAppProfile with dump-profiles and cat profman', () => {
  const adbCode = fs.readFileSync(path.join(rootDir, 'src/adb-controller.js'), 'utf-8');

  assert.ok(adbCode.includes('checkAppProfile(packageName'), 'AdbController must implement checkAppProfile');
  assert.ok(adbCode.includes('cmd package dump-profiles'), 'checkAppProfile must dump profiles');
  assert.ok(adbCode.includes('/data/misc/profman/'), 'checkAppProfile must check profman output text file');
  assert.ok(adbCode.includes('_mockCheckAppProfile'), 'AdbController must support mock check in demo mode');
});

test('AdbController in demo mode performs mock profile check', async () => {
  const controller = new AdbController();
  await controller.enableDemoMode();

  // Test an app with profile in demo mock
  const resReady = await controller.checkAppProfile('com.google.android.youtube');
  assert.strictEqual(typeof resReady.hasProfile, 'boolean');
  assert.strictEqual(resReady.hasProfile, true);
  assert.ok(resReady.lineCount > 0);

  // Test an app without profile in demo mock
  const resNone = await controller.checkAppProfile('org.coursera.android');
  assert.strictEqual(typeof resNone.hasProfile, 'boolean');
  assert.strictEqual(resNone.hasProfile, false);
  assert.strictEqual(resNone.lineCount, 0);
});

test('classifyApps sets initial hasProfile based on status', () => {
  const packageList = [
    { packageName: 'com.example.speedprof', path: '/data/app/~~a/base.apk', isSystem: false },
    { packageName: 'com.example.verif', path: '/data/app/~~b/base.apk', isSystem: false },
    { packageName: 'com.example.speed', path: '/data/app/~~c/base.apk', isSystem: false },
  ];
  const usageSet = new Map();
  const launcherSet = new Set(['com.example.speedprof', 'com.example.verif', 'com.example.speed']);
  const dexoptMap = new Map([
    ['com.example.speedprof', { status: 'speed-profile', reason: 'bg-dexopt', hasCode: true, isOverlay: false }],
    ['com.example.verif', { status: 'verify', reason: 'install', hasCode: true, isOverlay: false }],
    ['com.example.speed', { status: 'speed', reason: 'cmdline', hasCode: true, isOverlay: false }],
  ]);

  const classified = classifyApps(packageList, usageSet, launcherSet, dexoptMap);
  const all = [...classified.frequentlyUsed, ...classified.general, ...classified.cannotAot];

  const speedProfApp = all.find((a) => a.packageName === 'com.example.speedprof');
  assert.ok(speedProfApp);
  assert.strictEqual(speedProfApp.hasProfile, true);

  const verifApp = all.find((a) => a.packageName === 'com.example.verif');
  assert.ok(verifApp);
  assert.strictEqual(verifApp.hasProfile, false);

  const speedApp = all.find((a) => a.packageName === 'com.example.speed');
  assert.ok(speedApp);
  assert.strictEqual(speedApp.hasProfile, undefined);
});

test('main.js determines appMode dynamically based on hasProfile and binds profile actions', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  // Verify dynamic mode selection
  assert.ok(mainJs.includes("if (app.hasProfile === true) {\n    appMode = 'speed-profile';"), 'appMode should be speed-profile if hasProfile is true');
  assert.ok(mainJs.includes("} else if (app.hasProfile === false) {\n    appMode = 'speed';"), 'appMode should be speed if hasProfile is false');

  // Verify handlers and modal management
  assert.ok(mainJs.includes('function handleCheckSingleAppProfile'), 'main.js must define handleCheckSingleAppProfile');
  assert.ok(mainJs.includes('function openCheckProfileModal'), 'main.js must define openCheckProfileModal');
  assert.ok(mainJs.includes('function closeCheckProfileModal'), 'main.js must define closeCheckProfileModal');
  assert.ok(mainJs.includes('function handleStartBatchCheckProfile'), 'main.js must define handleStartBatchCheckProfile');

  // Verify event listeners
  assert.ok(mainJs.includes('el.btnBatchCheckProfile?.addEventListener'), 'main.js must bind btnBatchCheckProfile');
  assert.ok(mainJs.includes('.btn-check-profile'), 'main.js must support .btn-check-profile clicks');
});
