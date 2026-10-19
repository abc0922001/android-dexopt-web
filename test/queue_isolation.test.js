import test from 'node:test';
import assert from 'node:assert/strict';
import { AotQueueManager } from '../src/queue-manager.js';
import { AdbController } from '../src/adb-controller.js';

test('AotQueueManager.enqueue correctly records path and isSystem properties', () => {
  const qm = new AotQueueManager();
  const res1 = qm.enqueue({
    packageName: 'com.user.app',
    displayName: 'User App',
    path: '/data/app/~~abc/com.user.app-xyz/base.apk',
    isSystem: false,
  }, 'speed');

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.item.path, '/data/app/~~abc/com.user.app-xyz/base.apk');
  assert.strictEqual(res1.item.isSystem, false);

  const res2 = qm.enqueue({
    packageName: 'com.android.settings',
    displayName: 'Settings',
    path: '/system/priv-app/Settings/Settings.apk',
    isSystem: true,
  }, 'speed-profile');

  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.item.path, '/system/priv-app/Settings/Settings.apk');
  assert.strictEqual(res2.item.isSystem, true);
});

test('AotQueueManager.clearAll cleans all pending and historical tasks', () => {
  let changeCount = 0;
  const qm = new AotQueueManager({
    onQueueChange: () => { changeCount++; },
  });

  qm.enqueue({ packageName: 'app1' });
  qm.enqueue({ packageName: 'app2' });
  qm.enqueue({ packageName: 'app3' });

  assert.strictEqual(qm.items.length, 3);
  qm.clearAll({ cancelRunning: true });

  assert.strictEqual(qm.items.length, 0);
  assert.strictEqual(qm.pendingCount, 0);
  assert.strictEqual(qm.isProcessing, false);
  assert.ok(changeCount >= 1);
});

test('AotQueueManager.clearAll retains running task unless cancelRunning is specified', async () => {
  let resolveRunning;
  const runningPromise = new Promise((resolve) => { resolveRunning = resolve; });

  const qm = new AotQueueManager({
    onProcessItem: async () => {
      await runningPromise;
      return { status: 'speed' };
    },
  });

  qm.enqueue({ packageName: 'running.app' });
  qm.enqueue({ packageName: 'waiting.app' });

  // Wait a microtask for processNext to start running.app
  await new Promise((r) => setTimeout(r, 20));

  assert.strictEqual(qm.activeCount, 1);
  assert.strictEqual(qm.waitingCount, 1);

  // clearAll without cancelRunning: false should cancel waiting and keep running
  qm.clearAll({ cancelRunning: false });
  assert.strictEqual(qm.items.length, 1);
  assert.strictEqual(qm.items[0].packageName, 'running.app');
  assert.strictEqual(qm.waitingCount, 0);

  // Complete running task
  resolveRunning();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(qm.items[0].status, 'completed');

  // clearAll with cancelRunning: true clears everything
  qm.clearAll({ cancelRunning: true });
  assert.strictEqual(qm.items.length, 0);
});

test('AdbController demo data replaces foreign com.spotify.music with standard com.google.android.apps.maps', async () => {
  const controller = new AdbController();
  const demoData = await controller._getDemoApps({});
  
  const allDemoPkgs = [
    ...demoData.frequentlyUsed.map((a) => a.packageName),
    ...demoData.general.map((a) => a.packageName),
    ...demoData.cannotAot.map((a) => a.packageName),
  ];

  assert.ok(!allDemoPkgs.includes('com.spotify.music'), 'Demo mode must not contain com.spotify.music');
  assert.ok(allDemoPkgs.includes('com.google.android.apps.maps'), 'Demo mode must contain com.google.android.apps.maps');
});
