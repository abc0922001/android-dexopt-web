/**
 * AOT Task Queue Manager
 * Coordinates consecutive single-app AOT compilation tasks to prevent concurrent ADB conflicts
 * and provides real-time status tracking for running, waiting, and completed operations.
 */
export class AotQueueManager {
  constructor({ onProcessItem, onQueueChange, onItemStatusChange, onQueueStart, onQueueComplete, onQueueCancel } = {}) {
    this.queue = [];
    this.isProcessing = false;
    this.onProcessItem = onProcessItem || (async () => {});
    this.onQueueChange = onQueueChange || (() => {});
    this.onItemStatusChange = onItemStatusChange || (() => {});
    this.onQueueStart = onQueueStart || (() => {});
    this.onQueueComplete = onQueueComplete || (() => {});
    this.onQueueCancel = onQueueCancel || (() => {});
    this._nextId = 1;
    this._rootHookApplied = false;
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
   * @param {object} app
   * @param {string|object} [mode='speed'] Mode string or options object
   * @param {object} [options={}] Additional compilation options (reason, checkProf, clearProfile, splitName, etc.)
   */
  enqueue(app, mode = 'speed', options = {}) {
    if (this.isQueued(app.packageName)) {
      return { success: false, reason: 'already_queued' };
    }

    const modeStr = typeof mode === 'string' ? mode : (mode?.filter || mode?.mode || 'speed');
    const mergedOptions = typeof mode === 'object' && mode !== null ? { ...mode, ...options } : { ...options, filter: modeStr };

    const item = {
      id: this._nextId++,
      packageName: app.packageName,
      displayName: app.displayName || app.packageName,
      path: app.path || '',
      isSystem: !!app.isSystem,
      mode: modeStr,
      options: mergedOptions,
      status: 'waiting',
      previousStatus: app.status || 'unknown',
      previousReason: app.reason || 'unknown',
      newStatus: null,
      newReason: null,
      transition: null,
      queuedAt: Date.now(),
      startedAt: null,
      startTime: null,
      completedAt: null,
      endTime: null,
      durationMs: null,
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
      const now = Date.now();
      item.completedAt = now;
      item.endTime = now;
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
    const now = Date.now();
    for (const item of this.queue) {
      if (item.status === 'waiting') {
        item.status = 'cancelled';
        item.completedAt = now;
        item.endTime = now;
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

  /**
   * Cancel tasks and completely clear queue records
   * @param {{ cancelRunning?: boolean }} [options]
   */
  clearAll({ cancelRunning = false } = {}) {
    const now = Date.now();
    for (const item of this.queue) {
      if (item.status === 'waiting' || (cancelRunning && item.status === 'running')) {
        item.status = 'cancelled';
        item.completedAt = now;
        item.endTime = now;
        if (item.startedAt) {
          item.durationMs = now - item.startedAt;
          item.duration = `${(item.durationMs / 1000).toFixed(1)}s`;
        }
        this.notifyItemStatusChange(item);
      }
    }
    if (this._rootHookApplied && (cancelRunning || this.waitingCount === 0)) {
      this._rootHookApplied = false;
      try {
        this.onQueueCancel?.();
      } catch {
        // ignore
      }
    }
    if (cancelRunning) {
      this.queue = [];
      this.isProcessing = false;
    } else {
      this.queue = this.queue.filter((i) => i.status === 'running');
    }
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
      if (this._rootHookApplied && this.activeCount === 0 && this.waitingCount === 0) {
        this._rootHookApplied = false;
        try {
          this.onQueueComplete?.();
        } catch {
          // ignore
        }
      }
      return;
    }

    // Trigger onQueueStart once when queue starts executing from idle
    if (!this._rootHookApplied) {
      this._rootHookApplied = true;
      try {
        this.onQueueStart?.();
      } catch {
        // ignore
      }
    }

    this.isProcessing = true;
    nextItem.status = 'running';
    const start = Date.now();
    nextItem.startedAt = start;
    nextItem.startTime = start;
    this.notifyItemStatusChange(nextItem);
    this.notifyChange();

    try {
      const result = await this.onProcessItem(nextItem);
      nextItem.status = 'completed';
      nextItem.result = result;
      const end = Date.now();
      nextItem.completedAt = end;
      nextItem.endTime = end;
      nextItem.durationMs = end - nextItem.startedAt;
      nextItem.duration = `${(nextItem.durationMs / 1000).toFixed(1)}s`;
      if (result && result.status) {
        nextItem.newStatus = result.status;
        nextItem.newReason = result.reason || 'cmdline';
        nextItem.transition = `${nextItem.previousStatus} → ${nextItem.newStatus}`;
      }
    } catch (err) {
      nextItem.status = 'failed';
      nextItem.error = err.message || String(err);
      const end = Date.now();
      nextItem.completedAt = end;
      nextItem.endTime = end;
      nextItem.durationMs = end - nextItem.startedAt;
      nextItem.duration = `${(nextItem.durationMs / 1000).toFixed(1)}s`;
    } finally {
      this.notifyItemStatusChange(nextItem);
      this.isProcessing = false;
      this.notifyChange();
      // Continue next item in queue
      this.processNext();
    }
  }
}
