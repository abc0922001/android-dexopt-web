import { AdbController } from './adb-controller.js';
import { getAppIcon, ICONS } from './icons.js';
import { sortApps } from './parser.js';

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
  logDrawerOpen: false,
  logs: [],
};

// UI Elements
const el = {
  html: document.documentElement,
  themeToggle: document.getElementById('btnThemeToggle'),
  themeIcon: document.getElementById('themeIcon'),
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

  modeSpeed: document.getElementById('modeSpeed'),
  modeSpeedProfile: document.getElementById('modeSpeedProfile'),
  modeHintText: document.getElementById('modeHintText'),

  searchInput: document.getElementById('searchInput'),
  btnClearSearch: document.getElementById('btnClearSearch'),
  sortSelect: document.getElementById('sortSelect'),
  filterPills: document.querySelectorAll('.filter-pill'),

  countAll: document.getElementById('countAll'),
  countFrequentlyUsed: document.getElementById('countFrequentlyUsed'),
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
    renderDisconnectedState();
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
  const total = state.apps.frequentlyUsed.length + state.apps.general.length + state.apps.cannotAot.length;
  el.countAll.textContent = total;
  el.countFrequentlyUsed.textContent = state.apps.frequentlyUsed.length;
  el.countGeneral.textContent = state.apps.general.length;
  el.countCannotAot.textContent = state.apps.cannotAot.length;

  el.labelFrequentlyUsedCount.textContent = `${state.apps.frequentlyUsed.length} apps`;
  el.labelGeneralCount.textContent = `${state.apps.general.length} apps`;
  el.labelCannotAotCount.textContent = `${state.apps.cannotAot.length} apps`;
}

function renderAppGrids() {
  const query = state.searchQuery.trim().toLowerCase();

  const filterFn = (app) => {
    if (!query) return true;
    return app.displayName.toLowerCase().includes(query) || app.packageName.toLowerCase().includes(query);
  };

  const filteredFrequent = sortApps(state.apps.frequentlyUsed.filter(filterFn), state.sortOrder);
  const filteredGeneral = sortApps(state.apps.general.filter(filterFn), state.sortOrder);
  const filteredCannotAot = sortApps(state.apps.cannotAot.filter(filterFn), state.sortOrder);

  // Filter category visibility
  const showFrequent = (state.currentFilter === 'all' || state.currentFilter === 'frequently_used') && filteredFrequent.length > 0;
  const showGeneral = (state.currentFilter === 'all' || state.currentFilter === 'general') && filteredGeneral.length > 0;
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
    btn.addEventListener('click', async (e) => {
      const pkg = btn.dataset.package;
      await handleOptimizeApp(pkg, btn);
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

  const appMode = app.overrideMode || state.dexoptMode;
  const isSpeedOverride = app.overrideMode === 'speed';


  const actionButton = isAotSupported ? `
    <button
      data-package="${app.packageName}"
      data-mode="${appMode}"
      aria-label="最佳化 ${app.displayName} (使用 ${appMode} 模式)"
      class="btn-optimize-app min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold ${
        isSpeedOverride
          ? 'bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white shadow-md shadow-amber-500/20 ring-1 ring-amber-400'
          : 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm'
      } transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shrink-0"
    >
      ${ICONS.zap}
      <span>Optimize (${appMode})</span>
    </button>
  ` : `
    <button
      disabled
      aria-label="${app.displayName} 不支援 AOT 編譯"
      class="min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 cursor-not-allowed shrink-0"
    >
      不支援 AOT
    </button>
  `;

  return `
    <div id="card-${app.packageName.replace(/\./g, '_')}" class="bg-white dark:bg-[#131d2e] border border-slate-200/90 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700/80 rounded-2xl p-4 shadow-sm transition-all flex flex-col justify-between gap-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3 overflow-hidden">
          ${getAppIcon(app.packageName)}
          <div class="overflow-hidden">
            <h3 class="font-bold text-sm text-slate-900 dark:text-white truncate" title="${app.displayName}">
              ${app.displayName}
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 font-mono truncate" title="${app.packageName}">
              ${app.packageName}
            </p>
          </div>
        </div>
        ${actionButton}
      </div>

      <!-- Badges Row with high contrast -->
      <div class="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-100 dark:border-slate-800/50">
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${statusBadgeClass}">
          [status=${app.status}]
        </span>
        <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${reasonBadgeClass}">
          [reason=${app.reason}]
        </span>
        ${app.usageTimeFormatted ? `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border border-cyan-300 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-800 dark:text-cyan-300 ml-auto" title="近期前景使用時間: ${app.usageTimeFormatted}">
          ⏱️ ${app.usageTimeFormatted}
        </span>
        ` : ''}
      </div>
    </div>
  `;
}

/* ---------------- Single App Optimization ---------------- */

async function handleOptimizeApp(packageName, buttonEl) {
  const origHtml = buttonEl.innerHTML;
  buttonEl.disabled = true;
  buttonEl.innerHTML = `${ICONS.spinner} <span>編譯中...</span>`;

  const allApps = [...state.apps.frequentlyUsed, ...state.apps.general, ...state.apps.cannotAot];
  const app = allApps.find((a) => a.packageName === packageName);
  const targetMode = buttonEl.dataset.mode || app?.overrideMode || state.dexoptMode;

  try {
    const updated = await adbController.compileApp(packageName, targetMode, {
      onOutput: (chunk) => appendTerminalLog(chunk),
    });

    if (app) {
      app.status = updated.status;
      app.reason = updated.reason;

      // If compiled with speed-profile but fell back to verify, switch only this app's button to speed!
      if (targetMode === 'speed-profile' && updated.status === 'verify') {
        app.overrideMode = 'speed';
      } else if (targetMode === 'speed' && updated.status === 'speed') {
        delete app.overrideMode;
      }
    }

    renderAppGrids();
    if (targetMode === 'speed-profile' && updated.status === 'verify') {
      showToast(
        'Profile 未就緒，已切換按鈕',
        `[${app?.displayName || packageName}] 暫退回 verify，已為此 App 切換為 Optimize (speed)，再次點擊即可強制完整編譯！`,
        'warning'
      );
    } else {
      showToast('最佳化成功', `已將 [${app?.displayName || packageName}] 編譯為 ${updated.status}。`, 'info');
    }
  } catch (err) {
    showToast('最佳化失敗', err.message, 'error');
    buttonEl.disabled = false;
    buttonEl.innerHTML = origHtml;
  }
}

/* ---------------- Global System bg-dexopt-job ---------------- */

el.btnTriggerBgDexopt.addEventListener('click', async () => {
  if (state.isBgDexoptRunning) return;
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
  state.sortOrder = e.target.value;
  renderAppGrids();
});

/* ---------------- Initial Boot ---------------- */
applyTheme(state.theme);
setDexoptMode(state.dexoptMode);
renderDisconnectedState();

