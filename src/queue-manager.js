/**
 * AOT Task Queue Manager
 * Coordinates consecutive single-app AOT compilation tasks to prevent concurrent ADB conflicts
 * and provides real-time status tracking for running, waiting, and completed operations.
 */
export class AotQueueManager {
  constructor({ onProcessItem, onQueueChange, onItemStatusChange } = {}) {
    this.queue = [];
    this.isProcessing = false;
    this.onProcessItem = onProcessItem || (async () => {});
    this.onQueueChange = onQueueChange || (() => {});
    this.onItemStatusChange = onItemStatusChange || (() => {});
    this._nextId = 1;
  }

  /**
   * Returns a copy of all queue items
   */
  get items() {
    return [...this.queue];
  }

  /**
   * Number of tasks actively executing
   */
  get activeCount() {
    return this.queue.filter((i) => i.status === 'running').length;
  }

  /**
   * Number of tasks waiting to execute
   */
  get waitingCount() {
    return this.queue.filter((i) => i.status === 'waiting').length;
  }

  /**
   * Total pending tasks (running + waiting)
   */
  get pendingCount() {
    return this.activeCount + this.waitingCount;
  }

  /**
   * Checks whether a package is already in the active/waiting queue
   */
  isQueued(packageName) {
    return this.queue.some(
      (i) => i.packageName === packageName && (i.status === 'waiting' || i.status === 'running')
    );
  }

  /**
   * Returns current active/waiting task for package
   */
  getItem(packageName) {
    return this.queue.find(
      (i) => i.packageName === packageName && (i.status === 'waiting' || i.status === 'running')
    );
  }

  /**
   * Enqueue a new AOT task
   */
  enqueue(app, mode = 'speed') {
    if (this.isQueued(app.packageName)) {
      return { success: false, reason: 'already_queued' };
    }

    const item = {
      id: this._nextId++,
      packageName: app.packageName,
      displayName: app.displayName || app.packageName,
      mode,
      status: 'waiting',
      queuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      duration: null,
      error: null,
      result: null,
    };

    this.queue.push(item);
    this.notifyItemStatusChange(item);
    this.notifyChange();
    this.processNext();
    return { success: true, item };
  }

  /**
   * Cancel a waiting item by id
   */
  cancelItem(id) {
    const item = this.queue.find((i) => i.id === id);
    if (!item) return false;
    if (item.status === 'waiting') {
      item.status = 'cancelled';
      item.completedAt = Date.now();
      this.notifyItemStatusChange(item);
      this.notifyChange();
      return true;
    }
    return false;
  }

  /**
   * Cancel all items currently in waiting status
   */
  cancelAllPending() {
    let cancelled = 0;
    for (const item of this.queue) {
      if (item.status === 'waiting') {
        item.status = 'cancelled';
        item.completedAt = Date.now();
        this.notifyItemStatusChange(item);
        cancelled++;
      }
    }
    if (cancelled > 0) {
      this.notifyChange();
    }
    return cancelled;
  }

  /**
   * Remove finished and cancelled items from history
   */
  clearFinished() {
    this.queue = this.queue.filter((i) => i.status === 'waiting' || i.status === 'running');
    this.notifyChange();
  }

  notifyItemStatusChange(item) {
    try {
      this.onItemStatusChange?.(item);
    } catch {
      // safe callback invocation
    }
  }

  notifyChange() {
    try {
      this.onQueueChange?.(this.items);
    } catch {
      // safe callback invocation
    }
  }

  /**
   * Sequential consumer picking items one by one
   */
  async processNext() {
    if (this.isProcessing) return;

    const nextItem = this.queue.find((i) => i.status === 'waiting');
    if (!nextItem) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    nextItem.status = 'running';
    nextItem.startedAt = Date.now();
    this.notifyItemStatusChange(nextItem);
    this.notifyChange();

    try {
      const result = await this.onProcessItem(nextItem);
      nextItem.status = 'completed';
      nextItem.result = result;
      nextItem.completedAt = Date.now();
      nextItem.duration = `${((nextItem.completedAt - nextItem.startedAt) / 1000).toFixed(1)}s`;
    } catch (err) {
      nextItem.status = 'failed';
      nextItem.error = err.message || String(err);
      nextItem.completedAt = Date.now();
      nextItem.duration = `${((nextItem.completedAt - nextItem.startedAt) / 1000).toFixed(1)}s`;
    } finally {
      this.notifyItemStatusChange(nextItem);
      this.isProcessing = false;
      this.notifyChange();
      // Continue next item in queue
      this.processNext();
    }
  }
}
