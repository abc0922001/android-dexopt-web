import {
  Adb,
  AdbDaemonTransport,
  AdbSubprocessService,
} from '@yume-chan/adb';
import {
  AdbDaemonWebUsbDeviceManager,
} from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import {
  TextDecoderStream,
} from '@yume-chan/stream-extra';

import {
  parsePackageList,
  parseUsageStats,
  parseLauncherActivities,
  parseDumpsysPackageStream,
  parseSinglePackageDexopt,
  classifyApps,
} from './parser.js';

export class AdbController {
  constructor({ onLog, onStatusChange, onDeviceDisconnected }) {
    this.adb = null;
    this.device = null;
    this.deviceInfo = null;
    this.isDemoMode = false;
    this.onLog = onLog || (() => {});
    this.onStatusChange = onStatusChange || (() => {});
    this.onDeviceDisconnected = onDeviceDisconnected || (() => {});
    this.credentialStore = new AdbWebCredentialStore('AndroidDexoptWeb');
    this.bgDexoptRunning = false;

    // Listen to USB disconnection
    if (typeof navigator !== 'undefined' && navigator.usb) {
      navigator.usb.addEventListener('disconnect', (event) => {
        if (this.device && (event.device === this.device.raw || event.device.serialNumber === this.device.serial)) {
          this.log('系統', '檢測到裝置已被拔除中斷連線。');
          this.disconnect();
          this.onDeviceDisconnected();
        }
      });
    }
  }

  log(tag, message) {
    const time = new Date().toLocaleTimeString();
    this.onLog(`[${time}] [${tag}] ${message}`);
  }

  isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.usb;
  }

  /**
   * Connect to an Android device via WebUSB
   */
  async connect() {
    if (!this.isSupported()) {
      throw new Error('此瀏覽器不支援 WebUSB API。請使用 Chrome、Edge 或 Brave 瀏覽器。');
    }

    this.onStatusChange({ state: 'connecting', message: '正在請求 USB 裝置授權...' });
    this.log('WebUSB', '啟動裝置配對視窗...');

    let device;
    try {
      device = await AdbDaemonWebUsbDeviceManager.BROWSER.requestDevice();
    } catch (err) {
      if (err.name === 'NotFoundError') {
        throw new Error('使用者取消了裝置選擇。');
      }
      throw err;
    }

    if (!device) {
      throw new Error('未選擇任何 USB 裝置。');
    }

    this.device = device;
    this.log('WebUSB', `已選取裝置: ${device.name || 'Android Device'} (${device.serial || 'USB'})`);

    this.onStatusChange({ state: 'connecting', message: '正在建立 USB 連線並進行 RSA 握手認證...' });

    let connection;
    try {
      connection = await device.connect();
    } catch (err) {
      this.log('錯誤', `USB 接口佔用失敗: ${err.message}`);
      if (err.name === 'NetworkError' || err.message?.includes('claimInterface') || err.message?.includes('claim')) {
        throw new Error('無法存取 USB 介面！電腦本機可能正在運行 ADB Server，請在終端機執行 `adb kill-server` 後再重試。');
      }
      throw err;
    }

    this.log('ADB', '開始 ADB 認證...');
    let transport;
    try {
      transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: this.credentialStore,
      });
    } catch (err) {
      this.log('認證失敗', err.message);
      if (err.message?.includes('Auth') || err.message?.includes('unauthorized')) {
        throw new Error('手機尚未授權偵錯！請解鎖手機螢幕並勾選【永遠允許這台電腦進行偵錯】後重試。');
      }
      throw err;
    }

    this.adb = new Adb(transport);
    this.subprocess = new AdbSubprocessService(this.adb);
    this.isDemoMode = false;

    // Fetch device model & Android version
    this.onStatusChange({ state: 'connecting', message: '正在獲取裝置系統資訊...' });
    const model = await this.getDeviceProp('ro.product.model', 'Android Device');
    const release = await this.getDeviceProp('ro.build.version.release', '14');
    const brand = await this.getDeviceProp('ro.product.brand', '');

    this.deviceInfo = {
      model,
      release,
      brand,
      serial: device.serial || 'USB-Device',
      title: `${model} (Android ${release})`,
    };

    this.log('ADB', `已成功連線至 ${this.deviceInfo.title}`);
    this.onStatusChange({ state: 'connected', device: this.deviceInfo });
    return this.deviceInfo;
  }

  /**
   * Enter Mock/Demo Mode for demonstration & UI testing without hardware
   */
  async enableDemoMode() {
    this.disconnect();
    this.isDemoMode = true;
    this.deviceInfo = {
      model: 'Pixel 8',
      release: '14',
      brand: 'Google',
      serial: 'DEMO-PIXEL8-AOT',
      title: 'Pixel 8 (Android 14)',
    };
    this.log('模擬模式', '已切換至「示範模擬模式」 (Pixel 8 / Android 14)');
    this.onStatusChange({ state: 'connected', device: this.deviceInfo });
    return this.deviceInfo;
  }

  async getDeviceProp(prop, fallback = '') {
    if (this.isDemoMode || !this.adb) return fallback;
    try {
      const spawner = this.subprocess.shellProtocol ?? this.subprocess.noneProtocol;
      const res = await spawner.spawnWaitText(['getprop', prop]);
      return res.stdout ? res.stdout.trim() : (res.trim ? res.trim() : fallback);
    } catch (e) {
      return fallback;
    }
  }

  /**
   * Disconnect device and clear session
   */
  async disconnect() {
    this.bgDexoptRunning = false;
    if (this.adb) {
      try {
        await this.adb.close();
      } catch (e) {
        // ignore
      }
      this.adb = null;
    }
    this.device = null;
    this.deviceInfo = null;
    this.isDemoMode = false;
    this.onStatusChange({ state: 'disconnected', device: null });
    this.log('系統', '連線已中斷。');
  }

  /**
   * Execute command via shell protocol or fallback
   */
  async exec(commandArray, { onOutput } = {}) {
    const cmdStr = Array.isArray(commandArray) ? commandArray.join(' ') : commandArray;
    this.log('執行指令', cmdStr);

    if (this.isDemoMode) {
      return this._mockExec(commandArray, { onOutput });
    }

    if (!this.adb) {
      throw new Error('裝置尚未連線。');
    }

    const spawner = this.subprocess.shellProtocol ?? this.subprocess.noneProtocol;

    if (onOutput) {
      const process = await spawner.spawn(commandArray);
      
      const readStream = async (stream, isError = false) => {
        if (!stream) return '';
        let full = '';
        const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            full += value;
            onOutput(value, isError);
          }
        } finally {
          reader.releaseLock();
        }
        return full;
      };

      const [stdout, stderr] = await Promise.all([
        readStream(process.stdout, false),
        readStream(process.stderr, true),
      ]);

      const exitCode = await process.exited;
      return { stdout, stderr, exitCode };
    } else {
      const result = await spawner.spawnWaitText(commandArray);
      return typeof result === 'string' ? { stdout: result, stderr: '', exitCode: 0 } : result;
    }
  }

  /**
   * Scan and retrieve all apps, their usage stats, and Dexopt status
   */
  async scanApps({ onProgress } = {}) {
    if (this.isDemoMode) {
      return this._getDemoApps({ onProgress });
    }

    if (!this.adb) {
      throw new Error('未連線至裝置。');
    }

    onProgress?.({ phase: 1, message: '正在讀取所有安裝套件清單 (pm list packages -f)...' });
    this.log('掃描', '步驟 1/3: 執行 pm list packages -f');
    const pmResult = await this.exec(['pm', 'list', 'packages', '-f']);
    const pkgMap = parsePackageList(pmResult.stdout);
    this.log('掃描', `發現 ${pkgMap.size} 個套件`);

    onProgress?.({ phase: 2, message: '正在讀取使用統計與啟動活動資訊...' });
    this.log('掃描', '步驟 2/3: 執行 dumpsys usagestats 與 Launcher 活動過濾');
    
    // Usage stats query
    let usageData = new Map();
    try {
      const usageRes = await this.exec(['dumpsys', 'usagestats']);
      usageData = parseUsageStats(usageRes.stdout);
      this.log('掃描', `常用套件統計: 找到 ${usageData.size} 個近期前景活躍應用`);
    } catch (e) {
      this.log('警告', `dumpsys usagestats 讀取失敗，將改以 Launcher 判定為主: ${e.message}`);
    }

    // Launcher query
    let launcherSet = new Set();
    try {
      const launcherRes = await this.exec([
        'cmd', 'package', 'query-intent-activities',
        '-a', 'android.intent.action.MAIN',
        '-c', 'android.intent.category.LAUNCHER',
      ]);
      launcherSet = parseLauncherActivities(launcherRes.stdout);
    } catch (e) {
      // fallback
    }

    onProgress?.({ phase: 3, message: '正在批次提取 ART Dexopt 編譯狀態 (dumpsys package dexopt)...' });
    this.log('掃描', '步驟 3/3: 批次提取 Dexopt 狀態 (dumpsys package dexopt)');
    
    let dexoptRaw = '';
    // Priority 1: dumpsys package dexopt (fast targeted dump on Android 7-17)
    try {
      const res = await this.exec(['dumpsys', 'package', 'dexopt']);
      if (res.stdout && res.stdout.length > 50) {
        dexoptRaw = res.stdout;
        this.log('掃描', `已透過 dumpsys package dexopt 取得資料 (${dexoptRaw.length} 字元)`);
      }
    } catch (e) {
      this.log('警告', `dumpsys package dexopt 失敗: ${e.message}`);
    }

    // Priority 2: pm art dump (Android 14+ ART Service)
    if (!dexoptRaw) {
      try {
        const res = await this.exec(['pm', 'art', 'dump']);
        if (res.stdout && res.stdout.length > 50) {
          dexoptRaw = res.stdout;
          this.log('掃描', `已透過 pm art dump 取得資料 (${dexoptRaw.length} 字元)`);
        }
      } catch (e) {
        // fallback
      }
    }

    // Priority 3: dumpsys package (full dump fallback)
    if (!dexoptRaw) {
      this.log('掃描', '備援執行完整 dumpsys package...');
      const res = await this.exec(['dumpsys', 'package']);
      dexoptRaw = res.stdout;
    }

    const dexoptMap = parseDumpsysPackageStream(dexoptRaw);
    this.log('掃描', `成功解析 ${dexoptMap.size} 個套件之 Dexopt 紀錄`);

    onProgress?.({ phase: 4, message: '正在分群歸類應用程式 (常用 / 一般 / 不支援 AOT)...' });
    const classified = classifyApps(Array.from(pkgMap.values()), usageData, launcherSet, dexoptMap);
    
    this.log('掃描完成', `常用: ${classified.frequentlyUsed.length}, 一般: ${classified.general.length}, 不支援: ${classified.cannotAot.length}`);
    return classified;
  }

  /**
   * Run system bg-dexopt-job
   */
  async triggerBgDexoptJob({ onOutput, onFinish } = {}) {
    if (this.bgDexoptRunning) {
      throw new Error('背景最佳化任務已在執行中。');
    }

    this.bgDexoptRunning = true;
    this.log('系統最佳化', '開始觸發全局 bg-dexopt-job...');

    try {
      if (this.isDemoMode) {
        await this._mockBgDexoptJob({ onOutput });
      } else {
        // First try cmd package bg-dexopt-job, fallback to pm bg-dexopt-job
        try {
          await this.exec(['cmd', 'package', 'bg-dexopt-job'], { onOutput });
        } catch (err) {
          this.log('警告', `cmd package 失敗，改用舊版 pm 指令備援: ${err.message}`);
          await this.exec(['pm', 'bg-dexopt-job'], { onOutput });
        }
      }
      this.log('系統最佳化', '系統背景最佳化 (bg-dexopt-job) 執行完成。');
    } finally {
      this.bgDexoptRunning = false;
      onFinish?.();
    }
  }

  /**
   * Cancel system bg-dexopt-job
   */
  async cancelBgDexoptJob() {
    this.log('系統最佳化', '下達中斷 bg-dexopt-job 指令...');
    if (this.isDemoMode) {
      this.bgDexoptRunning = false;
      this.log('模擬模式', '已中斷模擬之 bg-dexopt-job 任務。');
      return { stdout: 'Success', stderr: '', exitCode: 0 };
    }
    const res = await this.exec(['cmd', 'package', 'cancel-bg-dexopt-job']);
    this.bgDexoptRunning = false;
    return res;
  }

  /**
   * Optimize a single app with specified mode
   * @param {string} packageName
   * @param {'speed'|'speed-profile'} mode
   */
  async compileApp(packageName, mode = 'speed', { onOutput } = {}) {
    this.log('單一最佳化', `正在編譯 [${packageName}]，模式: ${mode}...`);
    
    if (this.isDemoMode) {
      return this._mockCompileApp(packageName, mode, { onOutput });
    }

    // cmd package compile -m <mode> -f <package>
    const compileCmd = ['cmd', 'package', 'compile', '-m', mode, '-f', packageName];
    const compileRes = await this.exec(compileCmd, { onOutput });

    // Partial re-query with dumpsys package <packageName>
    this.log('狀態更新', `重新擷取 [${packageName}] 之最新狀態...`);
    const dumpRes = await this.exec(['dumpsys', 'package', packageName]);
    const updated = parseSinglePackageDexopt(dumpRes.stdout);
    
    this.log('完成', `[${packageName}] 已更新為 status=${updated.status} reason=${updated.reason}`);
    return updated;
  }

  /* ---------------- Mock / Demo Methods for Instant Browser Testing ---------------- */

  async _mockExec(commandArray, { onOutput }) {
    const cmd = commandArray.join(' ');
    await new Promise((r) => setTimeout(r, 600));
    const out = `Mock stdout for [${cmd}]: Success\n`;
    onOutput?.(out, false);
    return { stdout: out, stderr: '', exitCode: 0 };
  }

  async _mockBgDexoptJob({ onOutput }) {
    const steps = [
      'Running dexopt job for all packages in background...',
      'Optimizing: com.google.android.youtube [status=speed-profile]',
      'Optimizing: jp.naver.line.android [status=speed-profile]',
      'Optimizing: com.android.chrome [status=speed-profile]',
      'Optimizing: com.google.android.apps.maps [status=speed-profile]',
      'Compilation successful for 42 packages. dexopt completed.',
    ];
    for (const step of steps) {
      if (!this.bgDexoptRunning) break;
      await new Promise((r) => setTimeout(r, 800));
      this.log('bg-dexopt', step);
      onOutput?.(step + '\n', false);
    }
  }

  async _mockCompileApp(packageName, mode, { onOutput }) {
    await new Promise((r) => setTimeout(r, 1200));
    const output = `Compiling ${packageName} with mode=${mode} ...\nSuccess\n`;
    onOutput?.(output, false);
    return {
      status: mode,
      reason: 'cmdline',
      hasCode: true,
    };
  }

  async _getDemoApps({ onProgress }) {
    onProgress?.({ phase: 1, message: '正在讀取示範套件資料...' });
    await new Promise((r) => setTimeout(r, 300));
    onProgress?.({ phase: 2, message: '正在整理分類...' });
    await new Promise((r) => setTimeout(r, 200));

    // High quality demo data faithfully reflecting the screenshots (Dark.jfif and Light.jfif)
    const frequentlyUsed = [
      {
        packageName: 'com.google.android.chrome',
        displayName: 'Google Chrome',
        path: '/data/app/com.google.android.chrome/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '2h 45m',
      },
      {
        packageName: 'jp.naver.line.android',
        displayName: 'LINE',
        path: '/data/app/jp.naver.line.android/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '1h 30m',
      },
      {
        packageName: 'com.android.chrome.beta',
        displayName: 'Lunch Chrome',
        path: '/data/app/com.android.chrome.beta/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '54m',
      },
      {
        packageName: 'com.google.android.youtube',
        displayName: 'YouTube',
        path: '/data/app/com.google.android.youtube/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '48m',
      },
      {
        packageName: 'com.spotify.music',
        displayName: 'Spotify',
        path: '/data/app/com.spotify.music/base.apk',
        isSystem: false,
        status: 'speed',
        reason: 'cmdline',
        hasCode: true,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '35m',
      },
      {
        packageName: 'org.telegram.messenger',
        displayName: 'Telegram',
        path: '/data/app/org.telegram.messenger/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '22m',
      },
    ];

    const general = [
      {
        packageName: 'android.soiemanann',
        displayName: 'Aniaon App',
        path: '/system/priv-app/Aniaon/base.apk',
        isSystem: true,
        status: 'verify',
        reason: 'vdex',
        hasCode: true,
        isCannotAot: false,
        tier: 'general',
      },
      {
        packageName: 'com.ankind.connector',
        displayName: 'Android Irmx',
        path: '/system/app/Irmx/base.apk',
        isSystem: true,
        status: 'verify',
        reason: 'vdex',
        hasCode: true,
        isCannotAot: false,
        tier: 'general',
      },
      {
        packageName: 'com.android.settings',
        displayName: 'Settings',
        path: '/system/priv-app/Settings/Settings.apk',
        isSystem: true,
        status: 'verify',
        reason: 'vdex',
        hasCode: true,
        isCannotAot: false,
        tier: 'general',
      },
      {
        packageName: 'com.google.android.calculator',
        displayName: 'Calculator',
        path: '/system/app/Calculator/Calculator.apk',
        isSystem: true,
        status: 'verify',
        reason: 'vdex',
        hasCode: true,
        isCannotAot: false,
        tier: 'general',
      },
      {
        packageName: 'com.google.android.calendar',
        displayName: 'Google Calendar',
        path: '/data/app/com.google.android.calendar/base.apk',
        isSystem: false,
        status: 'verify',
        reason: 'vdex',
        hasCode: true,
        isCannotAot: false,
        tier: 'general',
      },
      {
        packageName: 'com.google.android.gm',
        displayName: 'Gmail',
        path: '/data/app/com.google.android.gm/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        isCannotAot: false,
        tier: 'general',
      },
    ];

    const cannotAot = [
      {
        packageName: 'com.google.android.theme.pixel.overlay',
        displayName: 'Pixel Live Wallpaper Stub',
        path: '/product/overlay/PixelTheme.apk',
        isSystem: true,
        status: 'N/A',
        reason: 'no-code',
        hasCode: false,
        isCannotAot: true,
        tier: 'cannot_aot',
      },
      {
        packageName: 'com.android.systemui.res.overlay',
        displayName: 'System UI Resource Overlay',
        path: '/system/overlay/SysUIOverlay.apk',
        isSystem: true,
        status: 'N/A',
        reason: 'no-code',
        hasCode: false,
        isCannotAot: true,
        tier: 'cannot_aot',
      },
    ];

    return {
      frequentlyUsed,
      general,
      cannotAot,
    };
  }
}
