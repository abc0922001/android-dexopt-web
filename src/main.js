import { AdbController } from './adb-controller.js';
import { getAppIcon, ICONS } from './icons.js';
import { sortApps } from './parser.js';
import { AotQueueManager } from './queue-manager.js';
import { APP_VERSION, getFormattedVersion } from './version.js';

// Application State
const state = {
  dexoptMode: 'speed-profile', // 'speed' | 'speed-profile'
  currentFilter: 'all',        // 'all' | 'frequently_used' | 'general' | 'cannot_aot'
  searchQuery: '',
  sortOrder: 'default',        // 'default' | 'status_unknown_first' | 'status_speed_first' | 'name_asc' | 'usage_desc'
  theme: localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  connectedDevice: null,
  apps: {
    frequentlyUsed: [],
    general: [],
    cannotAot: [],
  },
  isScanning: false,
  isBgDexoptRunning: false,
  isBatchRunning: false,
  batchTargetMode: 'speed',
  fastAotMode: 'speed',
  pendingForceStop: null, // null | { mode: 'single', packageName, displayName } | { mode: 'batch' }
  logDrawerOpen: false,
  logs: [],
};

// UI Elements
const el = {
  html: document.documentElement,
  themeToggle: document.getElementById('btnThemeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  btnOpenQueueModal: document.getElementById('btnOpenQueueModal'),
  queueBadge: document.getElementById('queueBadge'),
  toggleLog: document.getElementById('btnToggleLog'),
  logActiveDot: document.getElementById('logActiveDot'),
  logDrawer: document.getElementById('logDrawer'),
  btnCloseLog: document.getElementById('btnCloseLog'),
  btnClearLog: document.getElementById('btnClearLog'),
  btnCopyLog: document.getElementById('btnCopyLog'),
  terminalContent: document.getElementById('terminalContent'),

  connectionContainer: document.getElementById('connectionContainer'),
  btnConnect: document.getElementById('btnConnect'),
  btnDemoMode: document.getElementById('btnDemoMode'),
  btnConnectHero: document.getElementById('btnConnectHero'),
  btnDemoHero: document.getElementById('btnDemoHero'),

  btnTriggerBgDexopt: document.getElementById('btnTriggerBgDexopt'),
  btnCancelBgDexopt: document.getElementById('btnCancelBgDexopt'),
  bgDexoptBtnText: document.getElementById('bgDexoptBtnText'),
  btnFastAot: document.getElementById('btnFastAot'),
  fastAotVerifyBadge: document.getElementById('fastAotVerifyBadge'),
  btnBatchSpeedProfile: document.getElementById('btnBatchSpeedProfile'),
  btnBatchSpeed: document.getElementById('btnBatchSpeed'),
  btnBatchForceStop: document.getElementById('btnBatchForceStop'),
  btnBatchCheckProfile: document.getElementById('btnBatchCheckProfile'),
  btnCancelBatch: document.getElementById('btnCancelBatch'),

  batchProgressBarContainer: document.getElementById('batchProgressBarContainer'),
  batchProgressTitle: document.getElementById('batchProgressTitle'),
  batchProgressCount: document.getElementById('batchProgressCount'),
  batchProgressBar: document.getElementById('batchProgressBar'),
  batchProgressCurrentApp: document.getElementById('batchProgressCurrentApp'),
  btnStopBatchProgress: document.getElementById('btnStopBatchProgress'),

  checkProfileConfirmModal: document.getElementById('checkProfileConfirmModal'),
  checkProfileScopeFrequentlyUsedCount: document.getElementById('checkProfileScopeFrequentlyUsedCount'),
  checkProfileScopeUserCount: document.getElementById('checkProfileScopeUserCount'),
  checkProfileScopeAllCount: document.getElementById('checkProfileScopeAllCount'),
  btnCancelCheckProfileModal: document.getElementById('btnCancelCheckProfileModal'),
  btnConfirmCheckProfileModal: document.getElementById('btnConfirmCheckProfileModal'),

  batchConfirmModal: document.getElementById('batchConfirmModal'),
  batchModalTargetMode: document.getElementById('batchModalTargetMode'),
  batchScopeUserCount: document.getElementById('batchScopeUserCount'),
  batchScopeAllCount: document.getElementById('batchScopeAllCount'),
  batchScopeSystemCount: document.getElementById('batchScopeSystemCount'),
  btnCancelBatchModal: document.getElementById('btnCancelBatchModal'),
  btnConfirmBatchModal: document.getElementById('btnConfirmBatchModal'),

  forceStopConfirmModal: document.getElementById('forceStopConfirmModal'),
  forceStopModalTitle: document.getElementById('forceStopModalTitle'),
  forceStopTargetPkg: document.getElementById('forceStopTargetPkg'),
  forceStopModalDesc: document.getElementById('forceStopModalDesc'),
  forceStopScopeContainer: document.getElementById('forceStopScopeContainer'),
  btnCancelForceStopModal: document.getElementById('btnCancelForceStopModal'),
  btnConfirmForceStopModal: document.getElementById('btnConfirmForceStopModal'),

  fastAotConfirmModal: document.getElementById('fastAotConfirmModal'),
  fastAotModalSubtitle: document.getElementById('fastAotModalSubtitle'),
  fastAotCommandPreview: document.getElementById('fastAotCommandPreview'),
  fastAotCandidateCount: document.getElementById('fastAotCandidateCount'),
  fastAotPreviewList: document.getElementById('fastAotPreviewList'),
  btnCancelFastAotModal: document.getElementById('btnCancelFastAotModal'),
  btnConfirmFastAotModal: document.getElementById('btnConfirmFastAotModal'),

  fastAotResultModal: document.getElementById('fastAotResultModal'),
  fastAotResultSubtitle: document.getElementById('fastAotResultSubtitle'),
  fastAotMetricTotal: document.getElementById('fastAotMetricTotal'),
  fastAotMetricSuccess: document.getElementById('fastAotMetricSuccess'),
  fastAotMetricFailed: document.getElementById('fastAotMetricFailed'),
  fastAotMetricDuration: document.getElementById('fastAotMetricDuration'),
  fastAotResultList: document.getElementById('fastAotResultList'),
  btnCloseFastAotResultModal: document.getElementById('btnCloseFastAotResultModal'),

  queueFloatingBanner: document.getElementById('queueFloatingBanner'),
  queueFloatingText: document.getElementById('queueFloatingText'),
  btnViewQueueFromBanner: document.getElementById('btnViewQueueFromBanner'),
  queueStatusModal: document.getElementById('queueStatusModal'),
  btnCloseQueueModal: document.getElementById('btnCloseQueueModal'),
  btnCloseQueueModalHeader: document.getElementById('btnCloseQueueModalHeader'),
  queueStatRunning: document.getElementById('queueStatRunning'),
  queueStatWaiting: document.getElementById('queueStatWaiting'),
  queueStatCompleted: document.getElementById('queueStatCompleted'),
  queueStatFailed: document.getElementById('queueStatFailed'),
  btnCancelAllPendingQueue: document.getElementById('btnCancelAllPendingQueue'),
  btnClearFinishedQueue: document.getElementById('btnClearFinishedQueue'),
  queueTableBody: document.getElementById('queueTableBody'),
  queueEmptyState: document.getElementById('queueEmptyState'),

  modeSpeed: document.getElementById('modeSpeed'),
  modeSpeedProfile: document.getElementById('modeSpeedProfile'),
  modeHintText: document.getElementById('modeHintText'),

  searchInput: document.getElementById('searchInput'),
  btnClearSearch: document.getElementById('btnClearSearch'),
  sortSelect: document.getElementById('sortSelect'),
  btnReapplySort: document.getElementById('btnReapplySort'),
  filterPills: document.querySelectorAll('.filter-pill'),

  countAll: document.getElementById('countAll'),
  countFrequentlyUsed: document.getElementById('countFrequentlyUsed'),
  countUser: document.getElementById('countUser'),
  countSystem: document.getElementById('countSystem'),
  countGeneral: document.getElementById('countGeneral'),
  countCannotAot: document.getElementById('countCannotAot'),

  mainAppArea: document.getElementById('mainAppArea'),
  scanningState: document.getElementById('scanningState'),
  scanningTitle: document.getElementById('scanningTitle'),
  scanningDesc: document.getElementById('scanningDesc'),
  disconnectedState: document.getElementById('disconnectedState'),
  appListContainer: document.getElementById('appListContainer'),

  sectionFrequentlyUsed: document.getElementById('sectionFrequentlyUsed'),
  sectionGeneral: document.getElementById('sectionGeneral'),
  sectionCannotAot: document.getElementById('sectionCannotAot'),
  gridFrequentlyUsed: document.getElementById('gridFrequentlyUsed'),
  gridGeneral: document.getElementById('gridGeneral'),
  gridCannotAot: document.getElementById('gridCannotAot'),
  labelFrequentlyUsedCount: document.getElementById('labelFrequentlyUsedCount'),
  labelGeneralCount: document.getElementById('labelGeneralCount'),
  labelCannotAotCount: document.getElementById('labelCannotAotCount'),
  emptySearchNotice: document.getElementById('emptySearchNotice'),
  emptySearchQuery: document.getElementById('emptySearchQuery'),
  offlineIndicatorBadge: document.getElementById('offlineIndicatorBadge'),

  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toastIcon'),
  toastTitle: document.getElementById('toastTitle'),
  toastMessage: document.getElementById('toastMessage'),
  toastClose: document.getElementById('toastClose'),
};

// Initialize Controller
const adbController = new AdbController({
  onLog: (msg) => appendTerminalLog(msg),
  onStatusChange: (status) => handleConnectionChange(status),
  onDeviceDisconnected: () => {
    showToast('裝置已中斷', 'USB 裝置連線已斷開。', 'warning');
    queueManager.cancelAllPending();
    renderDisconnectedState();
  },
});

function findApp(packageName) {
  return (
    state.apps.frequentlyUsed.find((a) => a.packageName === packageName) ||
    state.apps.general.find((a) => a.packageName === packageName) ||
    state.apps.cannotAot.find((a) => a.packageName === packageName)
  );
}

// Initialize AOT Task Queue Manager
const queueManager = new AotQueueManager({
  onProcessItem: async (item) => {
    appendTerminalLog(`\n[AOT 佇列] 正在編譯 [${item.displayName}] (${item.packageName})，模式: ${item.mode}...\n`);
    try {
      const updated = await adbController.compileApp(item.packageName, item.mode, {
        onOutput: (chunk) => appendTerminalLog(chunk),
      });

      const app = findApp(item.packageName);
      if (app) {
        app.status = updated.status;
        app.reason = updated.reason;
        if (item.mode === 'speed-profile' && updated.status === 'verify') {
          app.overrideMode = 'speed';
          showToast(
            'Profile 未就緒，已切換按鈕',
            `[${app.displayName}] 暫退回 verify，已為此 App 切換為 Optimize (speed)。`,
            'warning'
          );
        } else if (item.mode === 'speed' && updated.status === 'speed') {
          delete app.overrideMode;
          showToast('最佳化成功', `已將 [${app.displayName}] 編譯為 ${updated.status}。`, 'info');
        } else {
          showToast('最佳化完成', `[${app.displayName}] 編譯結果: ${updated.status}。`, 'info');
        }
      }

      return updated;
    } catch (err) {
      appendTerminalLog(`❌ [AOT 佇列] [${item.displayName}] 編譯失敗: ${err.message}\n`);
      showToast('編譯失敗', `[${item.displayName}] ${err.message}`, 'error');
      throw err;
    }
  },
  onItemStatusChange: (item) => {
    const app = findApp(item.packageName);
    if (app) {
      updateAppCardInDom(app);
      updatePillCounts();
    }
  },
  onQueueChange: (items) => {
    updateQueueUi(items);
  },
});

/* ---------------- Theme Setup ---------------- */

function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem('theme', theme);
  if (theme === 'dark') {
    el.html.classList.add('dark');
    el.themeIcon.innerHTML = ICONS.sun;
  } else {
    el.html.classList.remove('dark');
    el.themeIcon.innerHTML = ICONS.moon;
  }
}

el.themeToggle.addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
});

/* ---------------- Terminal Drawer ---------------- */

function appendTerminalLog(message) {
  state.logs.push(message);
  if (state.logs.length > 500) state.logs.shift();

  const line = document.createElement('div');
  line.textContent = message;
  el.terminalContent.appendChild(line);
  el.terminalContent.scrollTop = el.terminalContent.scrollHeight;

  // Pulse dot if drawer is closed
  if (!state.logDrawerOpen) {
    el.logActiveDot.classList.remove('hidden');
  }
}

function setLogDrawer(open) {
  state.logDrawerOpen = open;
  if (open) {
    el.logDrawer.classList.remove('translate-y-full');
    el.logActiveDot.classList.add('hidden');
    el.terminalContent.scrollTop = el.terminalContent.scrollHeight;
  } else {
    el.logDrawer.classList.add('translate-y-full');
  }
}

el.toggleLog.addEventListener('click', () => setLogDrawer(!state.logDrawerOpen));
el.btnCloseLog.addEventListener('click', () => setLogDrawer(false));
el.btnClearLog.addEventListener('click', () => {
  state.logs = [];
  el.terminalContent.innerHTML = '';
});
el.btnCopyLog.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.logs.join('\n'));
    showToast('已複製', '終端日誌已複製至剪貼簿。', 'info');
  } catch (e) {
    showToast('複製失敗', e.message, 'error');
  }
});

/* ---------------- Toast Notification ---------------- */

let toastTimer = null;
function showToast(title, message, type = 'info') {
  clearTimeout(toastTimer);
  el.toastTitle.textContent = title;
  el.toastMessage.textContent = message;

  let iconSvg = ICONS.zap;
  if (type === 'error') {
    iconSvg = `<svg class="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01"/></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`;
  }
  el.toastIcon.innerHTML = iconSvg;

  el.toast.classList.remove('translate-y-[-120%]', 'opacity-0', 'pointer-events-none');
  toastTimer = setTimeout(() => {
    el.toast.classList.add('translate-y-[-120%]', 'opacity-0', 'pointer-events-none');
  }, 4000);
}

el.toastClose.addEventListener('click', () => {
  el.toast.classList.add('translate-y-[-120%]', 'opacity-0', 'pointer-events-none');
});

/* ---------------- Dexopt Mode Selector ---------------- */

function setDexoptMode(mode) {
  state.dexoptMode = mode;
  
  if (mode === 'speed') {
    el.modeSpeed.className = 'px-3.5 py-1 text-xs font-semibold rounded-lg bg-cyan-400 text-slate-950 shadow-sm transition-all cursor-pointer';
    el.modeSpeed.setAttribute('aria-selected', 'true');
    el.modeSpeedProfile.className = 'px-3.5 py-1 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer';
    el.modeSpeedProfile.setAttribute('aria-selected', 'false');
    el.modeHintText.textContent = 'Hint: speed 強制完整 AOT 編譯所有位元碼，不依賴使用紀錄，啟動最快。';
  } else {
    el.modeSpeedProfile.className = 'px-3.5 py-1 text-xs font-semibold rounded-lg bg-cyan-400 text-slate-950 shadow-sm transition-all cursor-pointer';
    el.modeSpeedProfile.setAttribute('aria-selected', 'true');
    el.modeSpeed.className = 'px-3.5 py-1 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer';
    el.modeSpeed.setAttribute('aria-selected', 'false');
    el.modeHintText.textContent = 'Hint: speed-profile 僅針對熱點設定檔編譯；若 App 尚無 Profile 將退回 verify。';
  }

  // Update existing app optimize button labels
  renderAppGrids();
}

el.modeSpeed.addEventListener('click', () => setDexoptMode('speed'));
el.modeSpeedProfile.addEventListener('click', () => setDexoptMode('speed-profile'));

/* ---------------- Connection Handling ---------------- */

function renderHeaderConnection() {
  if (state.connectedDevice) {
    el.connectionContainer.innerHTML = `
      <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold shadow-sm">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>Connected: ${state.connectedDevice.title}</span>
        <button id="btnDisconnect" aria-label="中斷裝置連線 (Disconnect device)" title="中斷連線" class="ml-1 w-6 h-6 min-w-[24px] min-h-[24px] rounded hover:bg-emerald-500/20 text-slate-400 hover:text-rose-400 cursor-pointer flex items-center justify-center">
          ${ICONS.clear}
        </button>
      </div>
      <button id="btnRescan" aria-label="重新掃描裝置應用 (Rescan apps)" title="重新掃描裝置" class="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-center">
        ${ICONS.refresh}
      </button>
    `;

    document.getElementById('btnDisconnect')?.addEventListener('click', () => {
      adbController.disconnect();
      renderDisconnectedState();
    });

    document.getElementById('btnRescan')?.addEventListener('click', () => {
      startAppScan();
    });
  } else {
    el.connectionContainer.innerHTML = `
      <button id="btnConnect" aria-label="連接 USB 裝置 (Connect device)" class="min-h-[40px] px-4 py-2 rounded-xl text-sm font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all flex items-center gap-2 cursor-pointer active:scale-95">
        ${ICONS.usb}
        連接裝置 (Connect)
      </button>
      <button id="btnDemoMode" aria-label="切換示範模式 (Switch to demo mode)" class="min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-200/90 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all cursor-pointer flex items-center justify-center">
        示範模式 (Demo)
      </button>
    `;

    document.getElementById('btnConnect')?.addEventListener('click', handleConnect);
    document.getElementById('btnDemoMode')?.addEventListener('click', handleDemoMode);
  }
}

function handleConnectionChange({ state: connState, device, message }) {
  if (connState === 'connected') {
    state.connectedDevice = device;
    renderHeaderConnection();
    startAppScan();
  } else if (connState === 'connecting') {
    el.scanningState.classList.remove('hidden');
    el.disconnectedState.classList.add('hidden');
    el.appListContainer.classList.add('hidden');
    el.scanningTitle.textContent = '正在連接裝置...';
    el.scanningDesc.textContent = message || '請留意手機螢幕是否跳出 USB 偵錯授權詢問。';
  } else if (connState === 'disconnected') {
    renderDisconnectedState();
  }
}

function renderDisconnectedState() {
  state.connectedDevice = null;
  state.apps = { frequentlyUsed: [], general: [], cannotAot: [] };
  renderHeaderConnection();
  updatePillCounts();

  el.scanningState.classList.add('hidden');
  el.appListContainer.classList.add('hidden');
  el.disconnectedState.classList.remove('hidden');
}

async function handleConnect() {
  try {
    await adbController.connect();
  } catch (err) {
    showToast('連線失敗', err.message, 'error');
    renderDisconnectedState();
  }
}

async function handleDemoMode() {
  try {
    await adbController.enableDemoMode();
    showToast('示範模式已啟動', '已載入 Pixel 8 模擬環境，可自由測試模式切換與編譯。', 'info');
  } catch (err) {
    showToast('啟動失敗', err.message, 'error');
  }
}

el.btnConnectHero?.addEventListener('click', handleConnect);
el.btnDemoHero?.addEventListener('click', handleDemoMode);

/* ---------------- App Scan & List Rendering ---------------- */

function applySortOrder(sortMode = state.sortOrder) {
  state.sortOrder = sortMode;
  if (!state.apps || !Array.isArray(state.apps.frequentlyUsed)) return;

  if (sortMode === 'default') {
    state.apps.frequentlyUsed = sortApps(state.apps.frequentlyUsed, 'usage_desc');
    state.apps.general = sortApps(state.apps.general, 'name_asc');
    state.apps.cannotAot = sortApps(state.apps.cannotAot, 'name_asc');
  } else {
    state.apps.frequentlyUsed = sortApps(state.apps.frequentlyUsed, sortMode);
    state.apps.general = sortApps(state.apps.general, sortMode);
    state.apps.cannotAot = sortApps(state.apps.cannotAot, sortMode);
  }
}

async function startAppScan() {
  if (state.isScanning) return;
  state.isScanning = true;

  el.scanningState.classList.remove('hidden');
  el.disconnectedState.classList.add('hidden');
  el.appListContainer.classList.add('hidden');

  try {
    const classified = await adbController.scanApps({
      onProgress: ({ message }) => {
        el.scanningTitle.textContent = '正在掃描 Android ART 狀態...';
        el.scanningDesc.textContent = message;
      },
    });

    state.apps = classified;
    applySortOrder(state.sortOrder);
    updatePillCounts();
    renderAppGrids();

    el.scanningState.classList.add('hidden');
    el.appListContainer.classList.remove('hidden');
  } catch (err) {
    showToast('掃描失敗', err.message, 'error');
    el.scanningState.classList.add('hidden');
    el.appListContainer.classList.remove('hidden');
  } finally {
    state.isScanning = false;
  }
}

function updatePillCounts() {
  const allApps = [...state.apps.frequentlyUsed, ...state.apps.general, ...state.apps.cannotAot];
  const userCount = allApps.filter((a) => !a.isSystem && !a.isCannotAot).length;
  const systemCount = allApps.filter((a) => a.isSystem && !a.isCannotAot).length;

  el.countAll.textContent = allApps.length;
  el.countFrequentlyUsed.textContent = state.apps.frequentlyUsed.length;
  if (el.countUser) el.countUser.textContent = userCount;
  if (el.countSystem) el.countSystem.textContent = systemCount;
  el.countGeneral.textContent = state.apps.general.length;
  el.countCannotAot.textContent = state.apps.cannotAot.length;

  el.labelFrequentlyUsedCount.textContent = `${state.apps.frequentlyUsed.length} apps`;
  el.labelGeneralCount.textContent = `${state.apps.general.length} apps`;
  el.labelCannotAotCount.textContent = `${state.apps.cannotAot.length} apps`;

  if (el.batchScopeUserCount) el.batchScopeUserCount.textContent = `${userCount} 個`;
  if (el.batchScopeAllCount) el.batchScopeAllCount.textContent = `${userCount + systemCount} 個`;
  if (el.batchScopeSystemCount) el.batchScopeSystemCount.textContent = `${systemCount} 個`;

  if (el.checkProfileScopeFrequentlyUsedCount) el.checkProfileScopeFrequentlyUsedCount.textContent = `${state.apps.frequentlyUsed.length} 個`;
  if (el.checkProfileScopeUserCount) el.checkProfileScopeUserCount.textContent = `${userCount} 個`;
  if (el.checkProfileScopeAllCount) el.checkProfileScopeAllCount.textContent = `${userCount + systemCount} 個`;

  const verifyCount = allApps.filter((a) => !a.isCannotAot && (a.status || '').toLowerCase() === 'verify').length;
  if (el.fastAotVerifyBadge) {
    el.fastAotVerifyBadge.textContent = `${verifyCount}`;
    if (verifyCount > 0) {
      el.fastAotVerifyBadge.classList.remove('hidden');
    } else {
      el.fastAotVerifyBadge.classList.add('hidden');
    }
  }
}

function renderAppGrids() {
  const query = state.searchQuery.trim().toLowerCase();

  const filterFn = (app) => {
    if (query) {
      const match = app.displayName.toLowerCase().includes(query) || app.packageName.toLowerCase().includes(query);
      if (!match) return false;
    }
    if (state.currentFilter === 'user') {
      return !app.isSystem && !app.isCannotAot;
    }
    if (state.currentFilter === 'system') {
      return app.isSystem && !app.isCannotAot;
    }
    return true;
  };

  const filteredFrequent = state.apps.frequentlyUsed.filter(filterFn);
  const filteredGeneral = state.apps.general.filter(filterFn);
  const filteredCannotAot = state.apps.cannotAot.filter(filterFn);

  // Filter category visibility
  const isTypeFilter = state.currentFilter === 'all' || state.currentFilter === 'user' || state.currentFilter === 'system';
  const showFrequent = (isTypeFilter || state.currentFilter === 'frequently_used') && filteredFrequent.length > 0;
  const showGeneral = (isTypeFilter || state.currentFilter === 'general') && filteredGeneral.length > 0;
  const showCannotAot = (state.currentFilter === 'all' || state.currentFilter === 'cannot_aot') && filteredCannotAot.length > 0;

  el.sectionFrequentlyUsed.style.display = showFrequent ? 'block' : 'none';
  el.sectionGeneral.style.display = showGeneral ? 'block' : 'none';
  el.sectionCannotAot.style.display = showCannotAot ? 'block' : 'none';

  // Render cards
  el.gridFrequentlyUsed.innerHTML = filteredFrequent.map((app) => createAppCardHtml(app)).join('');
  el.gridGeneral.innerHTML = filteredGeneral.map((app) => createAppCardHtml(app)).join('');
  el.gridCannotAot.innerHTML = filteredCannotAot.map((app) => createAppCardHtml(app)).join('');

  // Attach optimize event listeners
  document.querySelectorAll('.btn-optimize-app').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pkg = btn.dataset.package;
      await handleOptimizeApp(pkg, btn);
    });
  });

  // Attach force-stop event listeners
  document.querySelectorAll('.btn-force-stop-app').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pkg = btn.dataset.package;
      const name = btn.dataset.name;
      openSingleForceStopModal(pkg, name);
    });
  });

  // Attach check-profile event listeners
  document.querySelectorAll('.btn-check-profile').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pkg = btn.dataset.package;
      await handleCheckSingleAppProfile(pkg, btn);
    });
  });

  const totalVisible = (showFrequent ? filteredFrequent.length : 0) +
                       (showGeneral ? filteredGeneral.length : 0) +
                       (showCannotAot ? filteredCannotAot.length : 0);

  if (totalVisible === 0) {
    el.emptySearchNotice.classList.remove('hidden');
    el.emptySearchQuery.textContent = query || state.currentFilter;
  } else {
    el.emptySearchNotice.classList.add('hidden');
  }
}

/**
 * Creates card HTML matching Dark.jfif and Light.jfif with high contrast badges
 */
function createAppCardHtml(app) {
  const isAotSupported = !app.isCannotAot;

  // High-contrast status badge styling compliant with WCAG AA (>= 4.5:1)
  let statusBadgeClass = 'border-slate-400 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200';
  if (app.status === 'speed' || app.status === 'speed-profile') {
    statusBadgeClass = 'border-emerald-600 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200';
  } else if (app.status === 'verify' || app.status === 'quicken') {
    statusBadgeClass = 'border-amber-600 dark:border-amber-500 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200';
  }

  // Reason badge styling
  const reasonBadgeClass = statusBadgeClass;

  // Issue #5: 有可用 Profile 顯示 speed-profile，無可用 Profile 顯示 speed
  // 未手動檢查 Profile 前一律遵循頂部 Dexopt modes；檢查後才依結果動態調整
  let appMode;
  if (app.overrideMode) {
    appMode = app.overrideMode;
  } else if (app.hasProfile === true) {
    appMode = 'speed-profile';
  } else if (app.hasProfile === false) {
    appMode = 'speed';
  } else {
    appMode = state.dexoptMode;
  }
  const isSpeedOverride = app.hasProfile === false && appMode === 'speed';

  // System vs User App badge
  const typeBadge = app.isSystem
    ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-300 dark:border-slate-700" title="系統內建應用程式">系統內建</span>`
    : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800" title="用戶自己安裝的應用程式">用戶安裝</span>`;

  // Profile readiness badge
  let profileBadge = '';
  if (isAotSupported) {
    if (app.hasProfile === true) {
      let lineText = '';
      if (typeof app.profileLines === 'number' && app.profileLines > 0) {
        lineText = ` (${app.profileLines}L)`;
      } else {
        lineText = ' (已生效)';
      }
      profileBadge = `
        <button
          type="button"
          data-package="${app.packageName}"
          title="Profile 熱點資料齊全${typeof app.profileLines === 'number' && app.profileLines > 0 ? ` (${app.profileLines} 行)` : ' (系統狀態已生效)'}，點擊重新檢查"
          class="btn-check-profile inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 cursor-pointer transition-all active:scale-95"
        >
          <svg class="w-3 h-3 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>profile: ready${lineText}</span>
        </button>
      `;
    } else if (app.hasProfile === false) {
      profileBadge = `
        <button
          type="button"
          data-package="${app.packageName}"
          title="無可用 Profile 熱點資料 (0 行)，已自動切換為 speed 編譯，點擊重新檢查"
          class="btn-check-profile inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border border-amber-500/40 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 cursor-pointer transition-all active:scale-95"
        >
          <svg class="w-3 h-3 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span>profile: none</span>
        </button>
      `;
    } else {
      profileBadge = `
        <button
          type="button"
          data-package="${app.packageName}"
          title="點擊檢查此 App 是否有可用 Profile 熱點資料"
          class="btn-check-profile inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer transition-all active:scale-95"
        >
          <svg class="w-3 h-3 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>profile: 檢查</span>
        </button>
      `;
    }
  }

  const queueItem = queueManager.getItem(app.packageName);
  let actionButton = '';

  if (!isAotSupported) {
    actionButton = `
      <button
        disabled
        aria-label="${app.displayName} 不支援 AOT 編譯"
        class="min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 cursor-not-allowed shrink-0 flex items-center justify-center"
      >
        不支援 AOT
      </button>
    `;
  } else if (queueItem?.status === 'running') {
    actionButton = `
      <button
        disabled
        data-package="${app.packageName}"
        aria-label="${app.displayName} 正在 AOT 編譯中"
        class="btn-optimize-app min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 cursor-not-allowed shrink-0 flex items-center justify-center gap-1.5"
      >
        ${ICONS.spinner}
        <span class="truncate">編譯中...</span>
      </button>
    `;
  } else if (queueItem?.status === 'waiting') {
    actionButton = `
      <button
        disabled
        data-package="${app.packageName}"
        aria-label="${app.displayName} 已排入 AOT 佇列等待中"
        class="btn-optimize-app min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 cursor-not-allowed shrink-0 flex items-center justify-center gap-1.5"
      >
        <svg class="w-3.5 h-3.5 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 3"/></svg>
        <span class="truncate">佇列等待中...</span>
      </button>
    `;
  } else {
    actionButton = `
      <button
        data-package="${app.packageName}"
        data-mode="${appMode}"
        aria-label="最佳化 ${app.displayName} (使用 ${appMode} 模式)"
        class="btn-optimize-app min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold ${
          isSpeedOverride
            ? 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white shadow-md shadow-amber-500/20 ring-1 ring-amber-400'
            : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm'
        } transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-95 shrink-0"
      >
        ${ICONS.zap}
        <span class="truncate">Optimize (${appMode})</span>
      </button>
    `;
  }

  return `
    <div id="card-${app.packageName.replace(/\./g, '_')}" class="app-card bg-white dark:bg-[#131d2e] border border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700/80 rounded-2xl p-4 shadow-sm transition-all flex flex-col justify-between gap-3">
      <div class="app-card-header">
        <div class="app-card-info flex items-start gap-3 min-w-0">
          <div class="shrink-0 mt-0.5">
            ${getAppIcon(app.packageName)}
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="font-bold text-sm text-slate-900 dark:text-white leading-snug break-words" title="${app.displayName}">
              ${app.displayName}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 font-mono break-all mt-0.5" title="${app.packageName}">
              ${app.packageName}
            </p>
          </div>
        </div>

        <div class="app-card-actions flex items-center gap-1.5">
          <button
            data-package="${app.packageName}"
            data-name="${app.displayName}"
            aria-label="強制停止 ${app.displayName} (Force Stop)"
            title="強制停止應用程式 (am force-stop)"
            class="btn-force-stop-app min-h-[38px] w-[38px] rounded-xl text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700/80 transition-all cursor-pointer flex items-center justify-center active:scale-95 shrink-0"
          >
            ${ICONS.stop}
          </button>
          ${actionButton}
        </div>
      </div>

      <!-- Badges Row with high contrast & type identifier -->
      <div class="app-card-badges flex items-center gap-2 flex-wrap pt-2 border-t border-slate-100 dark:border-slate-800/50">
        ${typeBadge}
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${statusBadgeClass}">
          [status=${app.status}]
        </span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${reasonBadgeClass}">
          [reason=${app.reason}]
        </span>
        ${profileBadge}
        ${app.usageTimeFormatted ? `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border border-cyan-300 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-800 dark:text-cyan-300 ml-auto" title="近期前景使用時間: ${app.usageTimeFormatted}">
          ⏱️ ${app.usageTimeFormatted}
        </span>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Updates a single app card in the DOM in-place without reordering or shifting the grid
 */
function updateAppCardInDom(app) {
  const cardId = `card-${app.packageName.replace(/\./g, '_')}`;
  const cardEl = document.getElementById(cardId);
  if (!cardEl) {
    renderAppGrids();
    return;
  }

  const temp = document.createElement('div');
  temp.innerHTML = createAppCardHtml(app);
  const newCard = temp.firstElementChild;
  if (!newCard) return;

  cardEl.replaceWith(newCard);

  // Bind single optimize action
  const optBtn = newCard.querySelector('.btn-optimize-app');
  optBtn?.addEventListener('click', async () => {
    await handleOptimizeApp(app.packageName, optBtn);
  });

  // Bind single force-stop action
  const stopBtn = newCard.querySelector('.btn-force-stop-app');
  stopBtn?.addEventListener('click', () => {
    openSingleForceStopModal(app.packageName, app.displayName);
  });

  // Bind single check-profile action
  const checkProfileBtn = newCard.querySelector('.btn-check-profile');
  checkProfileBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await handleCheckSingleAppProfile(app.packageName, checkProfileBtn);
  });
}

/* ---------------- Single App Optimization via Queue ---------------- */

async function handleOptimizeApp(packageName, buttonEl) {
  if (state.isBatchRunning || state.isBgDexoptRunning) {
    showToast('系統忙碌中', '批次最佳化或系統背景任務進行中，請稍候再操作個別應用。', 'warning');
    return;
  }

  const app = findApp(packageName);
  if (!app) return;

  const targetMode = buttonEl?.dataset?.mode || app.overrideMode || state.dexoptMode;
  const res = queueManager.enqueue(app, targetMode);

  if (!res.success && res.reason === 'already_queued') {
    showToast('已在佇列中', `[${app.displayName}] 已經在 AOT 執行佇列中等待或執行。`, 'info');
    return;
  }

  if (queueManager.waitingCount > 0) {
    showToast(
      '已加入 AOT 佇列',
      `[${app.displayName}] 已排入 AOT 佇列 (目前佇列共 ${queueManager.pendingCount} 個任務)。`,
      'info'
    );
  }
}

/* ---------------- Batch AOT Optimization ---------------- */

function openBatchModal(targetMode) {
  if (state.isBatchRunning || state.isBgDexoptRunning) return;
  if (queueManager.pendingCount > 0) {
    showToast('單一佇列進行中', '目前尚有單一 App AOT 佇列正在執行中，請等待完成後再啟動批次任務。', 'warning');
    return;
  }
  state.batchTargetMode = targetMode;

  if (el.batchModalTargetMode) {
    el.batchModalTargetMode.textContent = targetMode;
  }
  updatePillCounts();
  el.batchConfirmModal?.classList.remove('hidden');
}

function closeBatchModal() {
  el.batchConfirmModal?.classList.add('hidden');
}

async function handleStartBatch() {
  closeBatchModal();
  if (state.isBatchRunning) return;

  const targetMode = state.batchTargetMode || 'speed';
  const scopeEl = document.querySelector('input[name="batchScope"]:checked');
  const scope = scopeEl ? scopeEl.value : 'user';

  const allApps = [...state.apps.frequentlyUsed, ...state.apps.general, ...state.apps.cannotAot];
  
  let targetList = [];
  if (scope === 'user') {
    targetList = allApps.filter((a) => !a.isSystem && !a.isCannotAot);
  } else if (scope === 'system') {
    targetList = allApps.filter((a) => a.isSystem && !a.isCannotAot);
  } else {
    targetList = allApps.filter((a) => !a.isCannotAot);
  }

  if (targetList.length === 0) {
    showToast('無法執行', '選定範圍內沒有可進行 AOT 編譯的應用程式。', 'warning');
    return;
  }

  state.isBatchRunning = true;

  // Open log drawer for visibility
  setLogDrawer(true);

  // UI state updates
  el.batchProgressBarContainer?.classList.remove('hidden');
  el.btnFastAot?.setAttribute('disabled', 'true');
  el.btnBatchSpeed?.setAttribute('disabled', 'true');
  el.btnBatchSpeedProfile?.setAttribute('disabled', 'true');
  el.btnBatchCheckProfile?.setAttribute('disabled', 'true');
  el.btnTriggerBgDexopt?.setAttribute('disabled', 'true');
  el.btnCancelBatch?.classList.remove('hidden');

  let successCount = 0;
  let failedCount = 0;

  appendTerminalLog(`\n========== 開始批次 AOT 編譯 (目標模式: ${targetMode}, 範圍: ${scope}, 總數: ${targetList.length}) ==========\n`);

  for (let i = 0; i < targetList.length; i++) {
    if (!state.isBatchRunning) {
      appendTerminalLog(`\n⚠️ 批次編譯已由使用者中斷。\n`);
      showToast('批次編譯已中斷', `已執行 ${i}/${targetList.length} 個應用程式。`, 'warning');
      break;
    }

    const app = targetList[i];
    const pct = Math.round(((i + 1) / targetList.length) * 100);

    if (el.batchProgressCount) el.batchProgressCount.textContent = `[${i + 1}/${targetList.length}] (${pct}%)`;
    if (el.batchProgressBar) el.batchProgressBar.style.width = `${pct}%`;
    if (el.batchProgressCurrentApp) el.batchProgressCurrentApp.textContent = `正在編譯 [${i + 1}/${targetList.length}]: ${app.displayName} (${app.packageName})`;

    // Highlight app card
    const cardBtn = document.querySelector(`[data-package="${app.packageName}"]`);
    if (cardBtn) {
      cardBtn.disabled = true;
      cardBtn.innerHTML = `${ICONS.spinner} <span>編譯中...</span>`;
    }

    try {
      const updated = await adbController.compileApp(app.packageName, targetMode, {
        onOutput: (chunk) => appendTerminalLog(chunk),
        skipQueryStatus: true,
      });
      app.status = updated.status;
      app.reason = updated.reason;
      successCount++;
    } catch (err) {
      failedCount++;
      appendTerminalLog(`❌ [${app.packageName}] 編譯失敗: ${err.message}\n`);
    } finally {
      // Re-render this app's card in place
      updateAppCardInDom(app);
    }
  }

  const wasCancelled = !state.isBatchRunning;
  appendTerminalLog(`\n========== 批次 AOT 編譯${wasCancelled ? '已中斷' : '結束'} (成功: ${successCount}, 失敗: ${failedCount}) ==========\n`);

  if (!wasCancelled) {
    showToast('批次編譯完成', `已成功最佳化 ${successCount} 個應用程式，正在同步最新狀態...`, 'info');
  } else {
    showToast('批次編譯已中斷', `已執行 ${successCount + failedCount} 個應用程式，正在同步最新狀態...`, 'warning');
  }

  // Refresh status of all apps once at the end or upon cancellation
  await refreshAppStatuses(targetMode);

  state.isBatchRunning = false;
  el.btnFastAot?.removeAttribute('disabled');
  el.btnBatchSpeed?.removeAttribute('disabled');
  el.btnBatchSpeedProfile?.removeAttribute('disabled');
  el.btnBatchCheckProfile?.removeAttribute('disabled');
  el.btnTriggerBgDexopt?.removeAttribute('disabled');
  el.btnCancelBatch?.classList.add('hidden');

  setTimeout(() => {
    if (!state.isBatchRunning) {
      el.batchProgressBarContainer?.classList.add('hidden');
    }
  }, 4000);
}

/**
 * Batch re-query Dexopt status for all apps from device and update UI in-place
 */
async function refreshAppStatuses(targetMode) {
  appendTerminalLog('\n[狀態更新] 正在從裝置批次擷取最新 Dexopt 編譯狀態...\n');
  if (el.batchProgressCurrentApp) {
    el.batchProgressCurrentApp.textContent = '正在批次重新取得所有應用程式之最新 Dexopt 狀態...';
  }

  try {
    const dexoptMap = await adbController.getBatchDexoptStatusMap();
    const allApps = [...state.apps.frequentlyUsed, ...state.apps.general, ...state.apps.cannotAot];

    for (const app of allApps) {
      const info = dexoptMap.get(app.packageName);
      if (info) {
        app.status = info.status;
        app.reason = info.reason;
        if (info.hasCode === false) {
          app.hasCode = false;
        }

        // If batch was speed-profile but app fell back to verify, switch button to speed
        if (targetMode === 'speed-profile' && app.status === 'verify') {
          app.overrideMode = 'speed';
        } else if (targetMode === 'speed' && app.status === 'speed') {
          delete app.overrideMode;
        }
      }
    }

    renderAppGrids();
    updatePillCounts();
    appendTerminalLog('[狀態更新] 最新 Dexopt 狀態已全數同步完成。\n');
  } catch (err) {
    appendTerminalLog(`[狀態更新] 批次擷取狀態失敗: ${err.message}\n`);
  }
}

function handleCancelBatch() {
  if (!state.isBatchRunning) return;
  state.isBatchRunning = false;
  if (el.batchProgressCurrentApp) {
    el.batchProgressCurrentApp.textContent = '正在中斷任務，請稍候目前 App 完成...';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ---------------- Fast AOT Mode (Issue #3) ---------------- */

function getVerifyApps() {
  const allApps = [...state.apps.frequentlyUsed, ...state.apps.general];
  return allApps.filter((a) => !a.isCannotAot && (a.status || '').toLowerCase() === 'verify');
}

function updateFastAotModalMode(mode) {
  state.fastAotMode = mode;
  if (el.fastAotModalSubtitle) {
    el.fastAotModalSubtitle.textContent = `僅針對狀態為 verify 的應用程式執行 ${mode} 編譯`;
  }
  if (el.fastAotCommandPreview) {
    el.fastAotCommandPreview.textContent = `cmd package compile -m ${mode}`;
  }
}

function openFastAotModal(initialMode) {
  if (state.isBatchRunning || state.isBgDexoptRunning) return;
  if (queueManager.pendingCount > 0) {
    showToast('單一佇列進行中', '目前尚有單一 App AOT 佇列正在執行中，請等待完成後再啟動快速 AOT。', 'warning');
    return;
  }

  const candidates = getVerifyApps();
  if (candidates.length === 0) {
    showToast('無需最佳化', '目前所有支援的應用程式皆已完成編譯，沒有 status=verify 的待處理項目！', 'info');
    return;
  }

  const modeToUse = (typeof initialMode === 'string' ? initialMode : null) || state.fastAotMode || 'speed';
  state.fastAotMode = modeToUse;

  const targetRadio = document.querySelector(`input[name="fastAotMode"][value="${modeToUse}"]`);
  if (targetRadio) {
    targetRadio.checked = true;
  }
  updateFastAotModalMode(modeToUse);

  if (el.fastAotCandidateCount) {
    el.fastAotCandidateCount.textContent = `${candidates.length} 個`;
  }

  if (el.fastAotPreviewList) {
    el.fastAotPreviewList.innerHTML = candidates
      .map(
        (app) => `
        <div class="flex items-center justify-between py-1 border-b border-slate-200/50 dark:border-slate-800/50 last:border-0">
          <div class="min-w-0 pr-2">
            <span class="font-medium text-slate-800 dark:text-slate-200 truncate block">${escapeHtml(app.displayName)}</span>
            <span class="text-[10px] text-slate-500 font-mono truncate block">${escapeHtml(app.packageName)}</span>
          </div>
          <span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono shrink-0">verify</span>
        </div>
      `
      )
      .join('');
  }

  el.fastAotConfirmModal?.classList.remove('hidden');
}

function closeFastAotModal() {
  el.fastAotConfirmModal?.classList.add('hidden');
}

async function handleStartFastAot() {
  closeFastAotModal();
  if (state.isBatchRunning) return;

  const candidates = getVerifyApps();
  if (candidates.length === 0) {
    showToast('無法執行', '沒有找到 status=verify 的應用程式。', 'warning');
    return;
  }

  const selectedRadio = document.querySelector('input[name="fastAotMode"]:checked');
  const targetMode = selectedRadio ? selectedRadio.value : (state.fastAotMode || 'speed');
  state.fastAotMode = targetMode;

  state.isBatchRunning = true;
  setLogDrawer(true);

  // UI state updates
  el.batchProgressBarContainer?.classList.remove('hidden');
  if (el.batchProgressTitle) {
    el.batchProgressTitle.textContent = `快速 AOT 最佳化進行中 (僅 verify / ${targetMode} / 無 -f)`;
  }
  el.btnFastAot?.setAttribute('disabled', 'true');
  el.btnBatchSpeed?.setAttribute('disabled', 'true');
  el.btnBatchSpeedProfile?.setAttribute('disabled', 'true');
  el.btnBatchCheckProfile?.setAttribute('disabled', 'true');
  el.btnTriggerBgDexopt?.setAttribute('disabled', 'true');
  el.btnCancelBatch?.classList.remove('hidden');

  let successCount = 0;
  let failedCount = 0;
  const startTime = Date.now();
  const results = [];

  appendTerminalLog(`\n========== 開始快速 AOT 模式 (目標: status=verify, 模式: ${targetMode}, 無 -f 旗標, 總數: ${candidates.length}) ==========\n`);

  for (let i = 0; i < candidates.length; i++) {
    if (!state.isBatchRunning) {
      appendTerminalLog(`\n⚠️ 快速 AOT 編譯已由使用者中斷。\n`);
      showToast('快速 AOT 已中斷', `已執行 ${i}/${candidates.length} 個應用程式。`, 'warning');
      break;
    }

    const app = candidates[i];
    const pct = Math.round(((i + 1) / candidates.length) * 100);

    if (el.batchProgressCount) el.batchProgressCount.textContent = `[${i + 1}/${candidates.length}] (${pct}%)`;
    if (el.batchProgressBar) el.batchProgressBar.style.width = `${pct}%`;
    if (el.batchProgressCurrentApp) el.batchProgressCurrentApp.textContent = `正在快速編譯 [${i + 1}/${candidates.length}]: ${app.displayName} (${app.packageName})`;

    const cardBtn = document.querySelector(`[data-package="${app.packageName}"]`);
    if (cardBtn) {
      cardBtn.disabled = true;
      cardBtn.innerHTML = `${ICONS.spinner} <span>快速編譯中...</span>`;
    }

    const itemStartTime = Date.now();
    try {
      const updated = await adbController.compileApp(app.packageName, targetMode, {
        onOutput: (chunk) => appendTerminalLog(chunk),
        skipQueryStatus: true,
        force: false, // Issue #3 requirement: 不加 -f
      });
      app.status = updated.status;
      app.reason = updated.reason;
      successCount++;
      const itemDuration = ((Date.now() - itemStartTime) / 1000).toFixed(1);
      results.push({
        displayName: app.displayName,
        packageName: app.packageName,
        oldStatus: 'verify',
        newStatus: updated.status,
        success: true,
        duration: `${itemDuration}s`,
      });
    } catch (err) {
      failedCount++;
      appendTerminalLog(`❌ [${app.packageName}] 編譯失敗: ${err.message}\n`);
      results.push({
        displayName: app.displayName,
        packageName: app.packageName,
        oldStatus: 'verify',
        newStatus: 'verify',
        success: false,
        duration: '-',
        error: err.message,
      });
    } finally {
      updateAppCardInDom(app);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const wasCancelled = !state.isBatchRunning;
  appendTerminalLog(`\n========== 快速 AOT 模式${wasCancelled ? '已中斷' : '結束'} (模式: ${targetMode}, 成功: ${successCount}, 失敗: ${failedCount}, 總耗時: ${totalDuration}s) ==========\n`);

  // Refresh status of all apps once at the end
  await refreshAppStatuses(targetMode);

  state.isBatchRunning = false;
  el.btnFastAot?.removeAttribute('disabled');
  el.btnBatchSpeed?.removeAttribute('disabled');
  el.btnBatchSpeedProfile?.removeAttribute('disabled');
  el.btnBatchCheckProfile?.removeAttribute('disabled');
  el.btnTriggerBgDexopt?.removeAttribute('disabled');
  el.btnCancelBatch?.classList.add('hidden');

  setTimeout(() => {
    if (!state.isBatchRunning) {
      el.batchProgressBarContainer?.classList.add('hidden');
    }
  }, 4000);

  // Issue #3 requirement: "完全跑完再顯示執行結果"
  showFastAotResultModal({
    total: candidates.length,
    success: successCount,
    failed: failedCount,
    duration: `${totalDuration}s`,
    results,
    wasCancelled,
    mode: targetMode,
  });
}

function showFastAotResultModal({ total, success, failed, duration, results, wasCancelled, mode }) {
  if (el.fastAotMetricTotal) el.fastAotMetricTotal.textContent = `${total}`;
  if (el.fastAotMetricSuccess) el.fastAotMetricSuccess.textContent = `${success}`;
  if (el.fastAotMetricFailed) el.fastAotMetricFailed.textContent = `${failed}`;
  if (el.fastAotMetricDuration) el.fastAotMetricDuration.textContent = duration;

  if (el.fastAotResultSubtitle) {
    const modeText = mode || 'speed';
    el.fastAotResultSubtitle.textContent = wasCancelled
      ? `快速 AOT ${modeText} 編譯已由使用者中斷 (${success}/${total} 完成)`
      : `已完成所有 verify 應用的 ${modeText} 編譯與狀態同步`;
  }

  if (el.fastAotResultList) {
    el.fastAotResultList.innerHTML = results
      .map(
        (r) => `
        <div class="flex items-center justify-between p-2 rounded-lg ${r.success ? 'bg-emerald-500/5' : 'bg-rose-500/5'} border border-slate-200/40 dark:border-slate-800/40">
          <div class="min-w-0 pr-2">
            <span class="font-medium text-slate-800 dark:text-slate-200 truncate block">${escapeHtml(r.displayName)}</span>
            <span class="text-[10px] text-slate-400 font-mono truncate block">${escapeHtml(r.packageName)}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">${r.oldStatus}</span>
            <span class="text-slate-400 text-xs">➔</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${r.success ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/20 text-rose-600 dark:text-rose-300'}">${r.newStatus}</span>
            <span class="text-[10px] text-slate-400 font-mono">${r.duration}</span>
          </div>
        </div>
      `
      )
      .join('');
  }

  el.fastAotResultModal?.classList.remove('hidden');
}

function closeFastAotResultModal() {
  el.fastAotResultModal?.classList.add('hidden');
}

/* ---------------- Profile Inspection & Dynamic Mode (Issue #5) ---------------- */

async function handleCheckSingleAppProfile(packageName, buttonEl) {
  if (!state.connectedDevice) {
    showToast('尚未連線', '請先連線至 Android 裝置或啟動示範模式。', 'warning');
    return;
  }
  if (state.isBatchRunning || state.isBgDexoptRunning) {
    showToast('系統忙碌中', '目前有批次或背景任務進行中，請稍候。', 'warning');
    return;
  }

  const app = findApp(packageName);
  if (!app) return;

  if (buttonEl) {
    buttonEl.innerHTML = `${ICONS.spinner} <span>檢查中...</span>`;
    buttonEl.disabled = true;
  }

  appendTerminalLog(`\n[Profile 檢查] 開始檢查 ${app.displayName} (${packageName}) 之 Profile 熱點資料...\n`);

  try {
    const res = await adbController.checkAppProfile(packageName, {
      currentStatus: app.status,
      currentReason: app.reason,
      onOutput: (chunk) => appendTerminalLog(chunk),
    });

    app.hasProfile = res.hasProfile;
    app.profileLines = res.lineCount;
    app.overrideMode = res.hasProfile ? 'speed-profile' : 'speed';

    const lineDesc = typeof res.lineCount === 'number' && res.lineCount > 0 ? ` (${res.lineCount} 行)` : (res.source === 'dumpsys' ? ' (系統狀態已生效)' : '');
    const statusMsg = res.hasProfile
      ? `已檢測到 Profile 熱點${lineDesc}，已配置為 speed-profile 編譯。`
      : `未檢測到可用 Profile (0 行)，已自動切換為 speed 編譯以避免退回 verify。`;

    appendTerminalLog(`[Profile 檢查] ${app.displayName}: ${statusMsg}\n`);
    showToast('Profile 檢查完成', `${app.displayName}：${res.hasProfile ? `有熱點資料${lineDesc} (speed-profile)` : '無熱點資料 (自動轉為 speed)'}`, res.hasProfile ? 'success' : 'info');
  } catch (err) {
    appendTerminalLog(`❌ [Profile 檢查] ${app.displayName} 檢查失敗: ${err.message}\n`);
    showToast('檢查失敗', err.message, 'error');
  } finally {
    if (state.sortOrder === 'profile_ready_first' || state.sortOrder === 'profile_none_first') {
      applySortOrder();
      renderAppGrids();
    } else {
      updateAppCardInDom(app);
    }
  }
}

function openCheckProfileModal() {
  if (!state.connectedDevice) {
    showToast('尚未連線', '請先連線至 Android 裝置或啟動示範模式。', 'warning');
    return;
  }
  if (state.isBatchRunning || state.isBgDexoptRunning) {
    showToast('系統忙碌中', '目前已有批次或背景任務正在執行中。', 'warning');
    return;
  }
  updatePillCounts();
  el.checkProfileConfirmModal?.classList.remove('hidden');
}

function closeCheckProfileModal() {
  el.checkProfileConfirmModal?.classList.add('hidden');
}

async function handleStartBatchCheckProfile() {
  closeCheckProfileModal();
  if (state.isBatchRunning || !state.connectedDevice) return;

  const scopeRadio = document.querySelector('input[name="checkProfileScope"]:checked');
  const scope = scopeRadio ? scopeRadio.value : 'frequently_used';

  let targets = [];
  if (scope === 'frequently_used') {
    targets = state.apps.frequentlyUsed.filter((a) => !a.isCannotAot);
  } else if (scope === 'user') {
    const seen = new Set();
    targets = [...state.apps.frequentlyUsed, ...state.apps.general].filter((a) => {
      if (a.isCannotAot || a.isSystem || seen.has(a.packageName)) return false;
      seen.add(a.packageName);
      return true;
    });
  } else {
    const seen = new Set();
    targets = [...state.apps.frequentlyUsed, ...state.apps.general].filter((a) => {
      if (a.isCannotAot || seen.has(a.packageName)) return false;
      seen.add(a.packageName);
      return true;
    });
  }

  if (targets.length === 0) {
    showToast('無符合目標', '所選範圍內無可檢查之應用程式。', 'warning');
    return;
  }

  state.isBatchRunning = true;
  setLogDrawer(true);

  // UI state updates
  el.batchProgressBarContainer?.classList.remove('hidden');
  if (el.batchProgressTitle) {
    const scopeLabel = scope === 'frequently_used' ? '常用' : scope === 'user' ? '用戶安裝' : '全部';
    el.batchProgressTitle.textContent = `檢查 App Profile 熱點資料中 (${scopeLabel}範圍)`;
  }
  el.btnFastAot?.setAttribute('disabled', 'true');
  el.btnBatchSpeed?.setAttribute('disabled', 'true');
  el.btnBatchSpeedProfile?.setAttribute('disabled', 'true');
  el.btnBatchCheckProfile?.setAttribute('disabled', 'true');
  el.btnTriggerBgDexopt?.setAttribute('disabled', 'true');
  el.btnCancelBatch?.classList.remove('hidden');

  let withProfileCount = 0;
  let withoutProfileCount = 0;
  const startTime = Date.now();

  appendTerminalLog(`\n========== 開始批次檢查 Profile 熱點資料 (目標數: ${targets.length}, 範圍: ${scope}) ==========\n`);

  for (let i = 0; i < targets.length; i++) {
    if (!state.isBatchRunning) {
      appendTerminalLog(`\n⚠️ 批次 Profile 檢查已由使用者中斷。\n`);
      showToast('Profile 檢查已中斷', `已執行 ${i}/${targets.length} 個應用程式。`, 'warning');
      break;
    }

    const app = targets[i];
    const pct = Math.round(((i + 1) / targets.length) * 100);

    if (el.batchProgressCount) el.batchProgressCount.textContent = `[${i + 1}/${targets.length}] (${pct}%)`;
    if (el.batchProgressBar) el.batchProgressBar.style.width = `${pct}%`;
    if (el.batchProgressCurrentApp) el.batchProgressCurrentApp.textContent = `正在檢查 Profile [${i + 1}/${targets.length}]: ${app.displayName} (${app.packageName})`;

    try {
      const res = await adbController.checkAppProfile(app.packageName, {
        currentStatus: app.status,
        currentReason: app.reason,
        onOutput: (chunk) => appendTerminalLog(chunk),
      });
      app.hasProfile = res.hasProfile;
      app.profileLines = res.lineCount;
      app.overrideMode = res.hasProfile ? 'speed-profile' : 'speed';

      if (res.hasProfile) {
        withProfileCount++;
      } else {
        withoutProfileCount++;
      }
    } catch (err) {
      appendTerminalLog(`❌ [${app.packageName}] Profile 檢查失敗: ${err.message}\n`);
    } finally {
      updateAppCardInDom(app);
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  const wasCancelled = !state.isBatchRunning;
  appendTerminalLog(`\n========== Profile 檢查${wasCancelled ? '已中斷' : '完成'} (有 Profile: ${withProfileCount}, 無 Profile: ${withoutProfileCount}, 總耗時: ${totalDuration}s) ==========\n`);

  state.isBatchRunning = false;
  el.btnFastAot?.removeAttribute('disabled');
  el.btnBatchSpeed?.removeAttribute('disabled');
  el.btnBatchSpeedProfile?.removeAttribute('disabled');
  el.btnBatchCheckProfile?.removeAttribute('disabled');
  el.btnTriggerBgDexopt?.removeAttribute('disabled');
  el.btnCancelBatch?.classList.add('hidden');

  // 如果當前選取的排序是 Profile 相關排序，於完成後重新排序卡片網格
  if (state.sortOrder === 'profile_ready_first' || state.sortOrder === 'profile_none_first') {
    applySortOrder();
    renderAppGrids();
  }

  setTimeout(() => {
    if (!state.isBatchRunning) {
      el.batchProgressBarContainer?.classList.add('hidden');
    }
  }, 3500);

  if (!wasCancelled) {
    showToast('Profile 檢查完成', `共檢查 ${targets.length} 個應用程式：${withProfileCount} 個有熱點 (speed-profile)，${withoutProfileCount} 個無熱點 (speed)。`, 'success');
  }
}

/* ---------------- Force Stop Actions ---------------- */

function openSingleForceStopModal(packageName, displayName) {
  state.pendingForceStop = { mode: 'single', packageName, displayName };

  if (el.forceStopModalTitle) {
    el.forceStopModalTitle.textContent = `強制停止「${displayName}」？`;
  }
  if (el.forceStopTargetPkg) {
    el.forceStopTargetPkg.textContent = packageName;
  }
  if (el.forceStopModalDesc) {
    el.forceStopModalDesc.innerHTML = `
      強制停止將透過 <code class="px-1 py-0.5 bg-rose-200/50 dark:bg-rose-900/50 rounded font-mono text-[11px]">am force-stop ${packageName}</code> 立即終止該應用的所有進行中處理程序與背景服務，未儲存的內容可能遺失。下次開啟時，系統將重新載入最新編譯的 AOT 最佳化機器碼。
    `;
  }
  el.forceStopScopeContainer?.classList.add('hidden');
  el.forceStopConfirmModal?.classList.remove('hidden');
}

function openBatchForceStopModal() {
  if (state.isBatchRunning || state.isBgDexoptRunning) return;
  if (queueManager.pendingCount > 0) {
    showToast('佇列進行中', '目前尚有 App AOT 佇列在執行中，請等待完成後再執行批次強制停止。', 'warning');
    return;
  }
  state.pendingForceStop = { mode: 'batch' };

  if (el.forceStopModalTitle) {
    el.forceStopModalTitle.textContent = '批次強制停止應用程式？';
  }
  if (el.forceStopTargetPkg) {
    el.forceStopTargetPkg.textContent = '執行指令: am force-stop <package>';
  }
  if (el.forceStopModalDesc) {
    el.forceStopModalDesc.innerHTML = `
      批次強制停止將依所選範圍，逐一終止應用程式的所有背景進程與快取服務。這能確保剛編譯完畢的 AOT 最佳化機器碼在下次啟動時被立即重新載入。
    `;
  }
  el.forceStopScopeContainer?.classList.remove('hidden');
  el.forceStopConfirmModal?.classList.remove('hidden');
}

function closeForceStopModal() {
  el.forceStopConfirmModal?.classList.add('hidden');
  state.pendingForceStop = null;
}

async function handleConfirmForceStop() {
  const pending = state.pendingForceStop;
  closeForceStopModal();
  if (!pending) return;

  if (pending.mode === 'single') {
    const { packageName, displayName } = pending;
    try {
      await adbController.forceStopApp(packageName, {
        onOutput: (chunk) => appendTerminalLog(chunk),
      });
      showToast('成功強制停止', `已終止「${displayName}」之所有進行中處理程序與背景服務。`, 'info');
    } catch (err) {
      showToast('強制停止失敗', err.message, 'error');
    }
    return;
  }

  if (pending.mode === 'batch') {
    const scopeEl = document.querySelector('input[name="forceStopScope"]:checked');
    const scope = scopeEl ? scopeEl.value : 'user';

    const allApps = [...state.apps.frequentlyUsed, ...state.apps.general, ...state.apps.cannotAot];
    const targets = scope === 'user'
      ? allApps.filter((a) => !a.isSystem && !a.isCannotAot)
      : allApps.filter((a) => !a.isCannotAot);

    if (targets.length === 0) {
      showToast('無目標應用', '選定範圍內無可強制停止的應用程式。', 'warning');
      return;
    }

    appendTerminalLog(`\n========== 開始批次強制停止應用程式 (範圍: ${scope}, 總數: ${targets.length}) ==========\n`);
    let count = 0;

    for (const app of targets) {
      try {
        await adbController.forceStopApp(app.packageName, {
          onOutput: (chunk) => appendTerminalLog(chunk),
        });
        count++;
      } catch (err) {
        appendTerminalLog(`❌ [${app.packageName}] 強制停止失敗: ${err.message}\n`);
      }
    }

    appendTerminalLog(`\n========== 批次強制停止完成 (已終止 ${count} 個應用) ==========\n`);
    showToast('批次強制停止完成', `已成功強制停止 ${count} 個應用程式。`, 'info');
  }
}

/* ---------------- Global System bg-dexopt-job ---------------- */

el.btnTriggerBgDexopt.addEventListener('click', async () => {
  if (state.isBgDexoptRunning || state.isBatchRunning) return;
  if (queueManager.pendingCount > 0) {
    showToast('佇列進行中', '目前尚有 App AOT 佇列在執行中，請等待完成後再啟動系統背景最佳化。', 'warning');
    return;
  }
  state.isBgDexoptRunning = true;

  el.btnTriggerBgDexopt.disabled = true;
  el.bgDexoptBtnText.textContent = '系統背景最佳化執行中...';
  el.btnCancelBgDexopt.classList.remove('hidden');

  // Auto-open terminal drawer so user can monitor progress
  setLogDrawer(true);

  try {
    await adbController.triggerBgDexoptJob({
      onOutput: (chunk) => appendTerminalLog(chunk),
    });
    showToast('背景最佳化完成', '系統全局 bg-dexopt-job 已執行完畢，正在重新整理清單...', 'info');
    await startAppScan();
  } catch (err) {
    showToast('背景最佳化錯誤', err.message, 'error');
  } finally {
    state.isBgDexoptRunning = false;
    el.btnTriggerBgDexopt.disabled = false;
    el.bgDexoptBtnText.textContent = 'Trigger System bg-dexopt-job';
    el.btnCancelBgDexopt.classList.add('hidden');
  }
});

el.btnCancelBgDexopt.addEventListener('click', async () => {
  try {
    await adbController.cancelBgDexoptJob();
    showToast('中斷請求', '已發送中斷 bg-dexopt-job 指令。', 'warning');
  } catch (err) {
    showToast('中斷失敗', err.message, 'error');
  }
});

/* ---------------- AOT Queue Management UI ---------------- */

function updateQueueUi(items = queueManager.items) {
  const activeCount = queueManager.activeCount;
  const waitingCount = queueManager.waitingCount;
  const pendingCount = queueManager.pendingCount;

  // Header badge
  if (el.queueBadge) {
    el.queueBadge.textContent = `${pendingCount}`;
    if (pendingCount > 0) {
      el.queueBadge.classList.remove('hidden');
    } else {
      el.queueBadge.classList.add('hidden');
    }
  }

  // Floating banner
  if (el.queueFloatingBanner) {
    if (pendingCount > 0) {
      el.queueFloatingBanner.classList.remove('hidden');
      if (el.queueFloatingText) {
        const runningItem = items.find((i) => i.status === 'running');
        const runningText = runningItem ? `正在編譯 [${runningItem.displayName}]` : `${activeCount} 個執行中`;
        el.queueFloatingText.textContent = `AOT 佇列：${runningText}${waitingCount > 0 ? `，${waitingCount} 個等待中` : ''}`;
      }
    } else {
      el.queueFloatingBanner.classList.add('hidden');
    }
  }

  // Modal Counter Grid
  if (el.queueStatRunning) el.queueStatRunning.textContent = `${activeCount}`;
  if (el.queueStatWaiting) el.queueStatWaiting.textContent = `${waitingCount}`;
  if (el.queueStatCompleted) el.queueStatCompleted.textContent = `${items.filter((i) => i.status === 'completed').length}`;
  if (el.queueStatFailed) el.queueStatFailed.textContent = `${items.filter((i) => i.status === 'failed' || i.status === 'cancelled').length}`;

  // Disable "Cancel All Pending" if 0 waiting
  if (el.btnCancelAllPendingQueue) {
    el.btnCancelAllPendingQueue.disabled = waitingCount === 0;
  }

  // Render Table
  if (el.queueTableBody) {
    if (items.length === 0) {
      el.queueTableBody.innerHTML = '';
      el.queueEmptyState?.classList.remove('hidden');
    } else {
      el.queueEmptyState?.classList.add('hidden');
      el.queueTableBody.innerHTML = items
        .map((item) => {
          let statusBadge = '';
          if (item.status === 'running') {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 font-mono"><span class="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse"></span>執行中</span>`;
          } else if (item.status === 'waiting') {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-mono">⏳ 等待中</span>`;
          } else if (item.status === 'completed') {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-mono">✅ 已完成</span>`;
          } else if (item.status === 'cancelled') {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 font-mono">已取消</span>`;
          } else {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-mono" title="${escapeHtml(item.error || '')}">❌ 失敗</span>`;
          }

          let actionCell = '';
          if (item.status === 'waiting') {
            actionCell = `
              <button
                data-cancel-queue-id="${item.id}"
                data-cancel-pkg="${item.packageName}"
                class="btn-cancel-queue-item px-2 py-1 rounded text-[11px] text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                取消
              </button>
            `;
          } else if (item.status === 'failed' && item.error) {
            actionCell = `<span class="text-[10px] text-rose-400 font-mono truncate max-w-[120px] inline-block" title="${escapeHtml(item.error)}">${escapeHtml(item.error)}</span>`;
          } else {
            actionCell = `<span class="text-slate-400 text-[10px]">-</span>`;
          }

          return `
            <tr class="hover:bg-slate-100/50 dark:hover:bg-slate-800/40 transition-colors">
              <td class="py-2.5 px-3 whitespace-nowrap">${statusBadge}</td>
              <td class="py-2.5 px-3 min-w-0">
                <div class="font-medium text-slate-900 dark:text-slate-100 truncate">${escapeHtml(item.displayName)}</div>
                <div class="text-[10px] text-slate-400 font-mono truncate">${escapeHtml(item.packageName)}</div>
              </td>
              <td class="py-2.5 px-3 whitespace-nowrap">
                <span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-700 font-mono text-slate-700 dark:text-slate-300">${item.mode}</span>
              </td>
              <td class="py-2.5 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                ${item.duration || (item.status === 'running' ? '<span class="text-cyan-500">計算中...</span>' : '-')}
              </td>
              <td class="py-2.5 px-3 whitespace-nowrap text-right">
                ${actionCell}
              </td>
            </tr>
          `;
        })
        .join('');

      // Bind cancel buttons
      el.queueTableBody.querySelectorAll('.btn-cancel-queue-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.cancelQueueId, 10);
          const pkg = btn.dataset.cancelPkg;
          queueManager.cancelItem(id);
          const allApps = [...state.apps.frequentlyUsed, ...state.apps.general, ...state.apps.cannotAot];
          const app = allApps.find((a) => a.packageName === pkg);
          if (app) updateAppCardInDom(app);
          showToast('已取消佇列', `[${app?.displayName || pkg}] 已從 AOT 佇列中取消。`, 'warning');
        });
      });
    }
  }
}

function openQueueModal() {
  updateQueueUi();
  el.queueStatusModal?.classList.remove('hidden');
}

function closeQueueModal() {
  el.queueStatusModal?.classList.add('hidden');
}

/* ---------------- AOT Queue Listeners ---------------- */

el.btnOpenQueueModal?.addEventListener('click', openQueueModal);
el.btnViewQueueFromBanner?.addEventListener('click', openQueueModal);
el.btnCloseQueueModal?.addEventListener('click', closeQueueModal);
el.btnCloseQueueModalHeader?.addEventListener('click', closeQueueModal);

el.btnCancelAllPendingQueue?.addEventListener('click', () => {
  const count = queueManager.cancelAllPending();
  if (count > 0) {
    showToast('已取消等待任務', `已取消佇列中 ${count} 個等待中的 AOT 任務。`, 'warning');
    renderAppGrids();
  }
});

el.btnClearFinishedQueue?.addEventListener('click', () => {
  queueManager.clearFinished();
  showToast('已清除紀錄', '已清空已完成與已取消的歷史任務紀錄。', 'info');
});

/* ---------------- Fast AOT Listeners ---------------- */

el.btnFastAot?.addEventListener('click', openFastAotModal);
el.btnCancelFastAotModal?.addEventListener('click', closeFastAotModal);
el.btnConfirmFastAotModal?.addEventListener('click', handleStartFastAot);
el.btnCloseFastAotResultModal?.addEventListener('click', closeFastAotResultModal);
document.querySelectorAll('input[name="fastAotMode"]').forEach((radio) => {
  radio.addEventListener('change', (e) => {
    if (e.target.checked) {
      updateFastAotModalMode(e.target.value);
    }
  });
});

/* ---------------- Batch Compile Listeners ---------------- */

el.btnBatchSpeedProfile?.addEventListener('click', () => openBatchModal('speed-profile'));
el.btnBatchSpeed?.addEventListener('click', () => openBatchModal('speed'));
el.btnCancelBatchModal?.addEventListener('click', closeBatchModal);
el.btnConfirmBatchModal?.addEventListener('click', handleStartBatch);
el.btnCancelBatch?.addEventListener('click', handleCancelBatch);
el.btnStopBatchProgress?.addEventListener('click', handleCancelBatch);

/* ---------------- Force Stop Listeners ---------------- */

el.btnBatchForceStop?.addEventListener('click', openBatchForceStopModal);
el.btnCancelForceStopModal?.addEventListener('click', closeForceStopModal);
el.btnConfirmForceStopModal?.addEventListener('click', handleConfirmForceStop);

/* ---------------- Check Profile Listeners (Issue #5) ---------------- */

el.btnBatchCheckProfile?.addEventListener('click', openCheckProfileModal);
el.btnCancelCheckProfileModal?.addEventListener('click', closeCheckProfileModal);
el.btnConfirmCheckProfileModal?.addEventListener('click', handleStartBatchCheckProfile);

/* ---------------- Search & Filter Pills ---------------- */

el.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  if (state.searchQuery) {
    el.btnClearSearch.classList.remove('hidden');
  } else {
    el.btnClearSearch.classList.add('hidden');
  }
  renderAppGrids();
});

el.btnClearSearch.addEventListener('click', () => {
  el.searchInput.value = '';
  state.searchQuery = '';
  el.btnClearSearch.classList.add('hidden');
  renderAppGrids();
});

el.filterPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    el.filterPills.forEach((p) => {
      p.classList.remove('active');
      p.setAttribute('aria-selected', 'false');
    });
    pill.classList.add('active');
    pill.setAttribute('aria-selected', 'true');
    state.currentFilter = pill.dataset.filter;
    renderAppGrids();
  });
});

el.sortSelect?.addEventListener('change', (e) => {
  applySortOrder(e.target.value);
  renderAppGrids();
});

el.btnReapplySort?.addEventListener('click', () => {
  applySortOrder(el.sortSelect ? el.sortSelect.value : state.sortOrder);
  renderAppGrids();
  const selectedOption = el.sortSelect?.options[el.sortSelect.selectedIndex];
  const selectedText = selectedOption ? selectedOption.text : '目前排序';
  showToast('已重新排序', `已依「${selectedText}」重新排列所有卡片。`, 'info');
});

/* ---------------- Offline Support & Service Worker (Issue #1) ---------------- */

function initOfflineSupport() {
  function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    if (el.offlineIndicatorBadge) {
      if (!isOnline) {
        el.offlineIndicatorBadge.classList.remove('hidden');
      } else {
        el.offlineIndicatorBadge.classList.add('hidden');
      }
    }
  }

  window.addEventListener('online', () => {
    updateOnlineStatus();
    showToast('網路已連線', '已偵測到網際網路連線。', 'info');
  });

  window.addEventListener('offline', () => {
    updateOnlineStatus();
    showToast('已進入離線模式', '目前無網際網路連線，WebUSB 本機傳輸運作正常。', 'warning');
  });

  updateOnlineStatus();

  // Register Service Worker for offline PWA operation
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            installing?.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version available, cached for offline use.');
              }
            });
          });
        })
        .catch((err) => {
          console.warn('[SW] Registration failed:', err);
        });
    });
  }
}

/* ---------------- Application Version Display ---------------- */

function renderAppVersion() {
  const formatted = getFormattedVersion();
  const versionEls = document.querySelectorAll('#appVersion, #footerVersion, [data-app-version]');
  versionEls.forEach((item) => {
    item.textContent = formatted;
  });
}

/* ---------------- Initial Boot ---------------- */
renderAppVersion();
applyTheme(state.theme);
setDexoptMode(state.dexoptMode);
renderDisconnectedState();
initOfflineSupport();

