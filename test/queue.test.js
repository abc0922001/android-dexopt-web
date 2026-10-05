import test from 'node:test';
import assert from 'node:assert/strict';
import { AotQueueManager } from '../src/queue-manager.js';

test('AotQueueManager enqueues tasks and tracks active/waiting/pending counts', async () => {
  let processed = [];
  const manager = new AotQueueManager({
    onProcessItem: async (item) => {
      processed.push(item.packageName);
      await new Promise((r) => setTimeout(r, 50));
      return { status: item.mode };
    },
  });

  assert.strictEqual(manager.pendingCount, 0);
  assert.strictEqual(manager.isQueued('app.one'), false);

  // Enqueue 3 items rapidly
  const r1 = manager.enqueue({ packageName: 'app.one', displayName: 'App One' }, 'speed');
  const r2 = manager.enqueue({ packageName: 'app.two', displayName: 'App Two' }, 'speed');
  const r3 = manager.enqueue({ packageName: 'app.three', displayName: 'App Three' }, 'speed-profile');

  assert.strictEqual(r1.success, true);
  assert.strictEqual(r2.success, true);
  assert.strictEqual(r3.success, true);

  // Trying to enqueue already queued item returns already_queued
  const dup = manager.enqueue({ packageName: 'app.two', displayName: 'App Two' });
  assert.strictEqual(dup.success, false);
  assert.strictEqual(dup.reason, 'already_queued');

  // Verify counts while running
  assert.strictEqual(manager.isQueued('app.one'), true);
  assert.strictEqual(manager.isQueued('app.two'), true);
  assert.strictEqual(manager.isQueued('app.three'), true);

  // Wait for all to finish
  await new Promise((r) => setTimeout(r, 250));

  assert.strictEqual(manager.pendingCount, 0);
  assert.strictEqual(manager.activeCount, 0);
  assert.strictEqual(manager.waitingCount, 0);
  assert.deepStrictEqual(processed, ['app.one', 'app.two', 'app.three']);

  const allItems = manager.items;
  assert.strictEqual(allItems.length, 3);
  assert.ok(allItems.every((i) => i.status === 'completed'));
  assert.ok(allItems.every((i) => i.duration !== null));
});

test('AotQueueManager supports cancelling waiting tasks', async () => {
  let executed = [];
  const manager = new AotQueueManager({
    onProcessItem: async (item) => {
      executed.push(item.packageName);
      await new Promise((r) => setTimeout(r, 60));
      return { status: 'speed' };
    },
  });

  manager.enqueue({ packageName: 'app.running' });
  const item2 = manager.enqueue({ packageName: 'app.cancel.me' }).item;
  manager.enqueue({ packageName: 'app.cancel.all1' });
  manager.enqueue({ packageName: 'app.cancel.all2' });

  // Cancel single item
  const cancelOk = manager.cancelItem(item2.id);
  assert.strictEqual(cancelOk, true);

  // Cancel remaining pending
  const cancelledCount = manager.cancelAllPending();
  assert.strictEqual(cancelledCount, 2);

  // Wait for runner
  await new Promise((r) => setTimeout(r, 100));

  assert.deepStrictEqual(executed, ['app.running']);
  assert.strictEqual(manager.waitingCount, 0);

  // Clear finished/cancelled
  manager.clearFinished();
  assert.strictEqual(manager.items.length, 0);
});

test('AotQueueManager handles errors cleanly without stopping queue', async () => {
  const manager = new AotQueueManager({
    onProcessItem: async (item) => {
      if (item.packageName === 'app.fail') {
        throw new Error('Compilation simulated error');
      }
      return { status: 'speed' };
    },
  });

  manager.enqueue({ packageName: 'app.fail' });
  manager.enqueue({ packageName: 'app.success' });

  await new Promise((r) => setTimeout(r, 80));

  const items = manager.items;
  const failed = items.find((i) => i.packageName === 'app.fail');
  const success = items.find((i) => i.packageName === 'app.success');

  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.error, 'Compilation simulated error');
  assert.strictEqual(success.status, 'completed');
});

test('AotQueueManager triggers onItemStatusChange with correct lifecycle transitions', async () => {
  const statusTransitions = [];
  const manager = new AotQueueManager({
    onProcessItem: async (item) => {
      await new Promise((r) => setTimeout(r, 40));
      return { status: item.mode };
    },
    onItemStatusChange: (item) => {
      statusTransitions.push({
        pkg: item.packageName,
        status: item.status,
      });
    },
  });

  manager.enqueue({ packageName: 'app.alpha' }, 'speed');
  manager.enqueue({ packageName: 'app.beta' }, 'speed');

  await new Promise((r) => setTimeout(r, 150));

  // Verify app.alpha transitioned: waiting -> running -> completed
  const alphaTransitions = statusTransitions.filter((t) => t.pkg === 'app.alpha').map((t) => t.status);
  assert.deepStrictEqual(alphaTransitions, ['waiting', 'running', 'completed']);

  // Verify app.beta transitioned: waiting -> running -> completed
  const betaTransitions = statusTransitions.filter((t) => t.pkg === 'app.beta').map((t) => t.status);
  assert.deepStrictEqual(betaTransitions, ['waiting', 'running', 'completed']);

  // After completion, getItem must return undefined so card displays normal completed state (not stuck in compiling)
  assert.strictEqual(manager.getItem('app.alpha'), undefined);
  assert.strictEqual(manager.getItem('app.beta'), undefined);
  assert.strictEqual(manager.isQueued('app.alpha'), false);
  assert.strictEqual(manager.isQueued('app.beta'), false);
});

test('AotQueueManager triggers onItemStatusChange on cancel and failure', async () => {
  const statusTransitions = [];
  const manager = new AotQueueManager({
    onProcessItem: async (item) => {
      await new Promise((r) => setTimeout(r, 40));
      if (item.packageName === 'app.err') {
        throw new Error('Simulated failure');
      }
      return { status: 'speed' };
    },
    onItemStatusChange: (item) => {
      statusTransitions.push({
        pkg: item.packageName,
        status: item.status,
      });
    },
  });

  manager.enqueue({ packageName: 'app.err' });
  const item2 = manager.enqueue({ packageName: 'app.cancelling' }).item;

  manager.cancelItem(item2.id);

  await new Promise((r) => setTimeout(r, 80));

  const errTransitions = statusTransitions.filter((t) => t.pkg === 'app.err').map((t) => t.status);
  assert.deepStrictEqual(errTransitions, ['waiting', 'running', 'failed']);

  const cancelTransitions = statusTransitions.filter((t) => t.pkg === 'app.cancelling').map((t) => t.status);
  assert.deepStrictEqual(cancelTransitions, ['waiting', 'cancelled']);

  assert.strictEqual(manager.getItem('app.err'), undefined);
  assert.strictEqual(manager.getItem('app.cancelling'), undefined);
});

