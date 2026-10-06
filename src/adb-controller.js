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
  constructor({ onLog, onStatusChange, onDeviceDisconnected } = {}) {
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
    
    const dexoptMap = await this.getBatchDexoptStatusMap();

    onProgress?.({ phase: 4, message: '正在分群歸類應用程式 (常用 / 一般 / 不支援 AOT)...' });
    const classified = classifyApps(Array.from(pkgMap.values()), usageData, launcherSet, dexoptMap);
    
    this.log('掃描完成', `常用: ${classified.frequentlyUsed.length}, 一般: ${classified.general.length}, 不支援: ${classified.cannotAot.length}`);
    return classified;
  }

  /**
   * Batch retrieve and parse Dexopt status map for all packages on device
   * @returns {Promise<Map<string, { status: string, reason: string, hasCode: boolean, isOverlay: boolean }>>}
   */
  async getBatchDexoptStatusMap() {
    if (this.isDemoMode) {
      return new Map();
    }

    let dexoptRaw = '';
    // Priority 1: dumpsys package dexopt (fast targeted dump on Android 7-17)
    try {
      const res = await this.exec(['dumpsys', 'package', 'dexopt']);
      if (res.stdout && res.stdout.length > 50) {
        dexoptRaw = res.stdout;
        this.log('狀態更新', `已透過 dumpsys package dexopt 取得最新資料 (${dexoptRaw.length} 字元)`);
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
          this.log('狀態更新', `已透過 pm art dump 取得最新資料 (${dexoptRaw.length} 字元)`);
        }
      } catch (e) {
        // fallback
      }
    }

    // Priority 3: dumpsys package (full dump fallback)
    if (!dexoptRaw) {
      this.log('狀態更新', '備援執行完整 dumpsys package 取得最新資料...');
      const res = await this.exec(['dumpsys', 'package']);
      dexoptRaw = res.stdout;
    }

    const dexoptMap = parseDumpsysPackageStream(dexoptRaw);
    this.log('狀態更新', `成功解析 ${dexoptMap.size} 個套件之 Dexopt 紀錄`);
    return dexoptMap;
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
   * @param {object} options
   * @param {boolean} [options.skipQueryStatus=false] - When true, skips dumpsys package re-query (for batch processing)
   * @param {boolean} [options.force=true] - When true, adds -f flag to force compilation; when false, compiles without -f (fast mode)
   */
  async compileApp(packageName, mode = 'speed', { onOutput, skipQueryStatus = false, force = true } = {}) {
    this.log('最佳化', `正在編譯 [${packageName}]，模式: ${mode}${force ? ' (強制 -f)' : ' (快速/無 -f)'}...`);
    
    if (this.isDemoMode) {
      return this._mockCompileApp(packageName, mode, { onOutput, force });
    }

    // cmd package compile -m <mode> [-f] <package>
    const compileCmd = ['cmd', 'package', 'compile', '-m', mode];
    if (force) {
      compileCmd.push('-f');
    }
    compileCmd.push(packageName);

    const compileRes = await this.exec(compileCmd, { onOutput });

    if (skipQueryStatus) {
      this.log('完成', `[${packageName}] 編譯指令已送出 (批次模式略過單一 dumpsys 查詢)`);
      return {
        status: mode,
        reason: 'cmdline',
        hasCode: true,
      };
    }

    // Partial re-query with dumpsys package <packageName>
    this.log('狀態更新', `重新擷取 [${packageName}] 之最新狀態...`);
    const dumpRes = await this.exec(['dumpsys', 'package', packageName]);
    const updated = parseSinglePackageDexopt(dumpRes.stdout);
    
    this.log('完成', `[${packageName}] 已更新為 status=${updated.status} reason=${updated.reason}`);
    return updated;
  }

  /**
   * Force stop an application via `am force-stop <packageName>`
   * @param {string} packageName
   */
  async forceStopApp(packageName, { onOutput } = {}) {
    this.log('強制停止', `正在終止 [${packageName}] 之所有進程與背景服務...`);

    if (this.isDemoMode) {
      await new Promise((r) => setTimeout(r, 400));
      const msg = `[am force-stop ${packageName}]: Process terminated successfully.\n`;
      this.log('強制停止', `已成功強制停止示範應用 [${packageName}]`);
      onOutput?.(msg, false);
      return { stdout: msg, stderr: '', exitCode: 0 };
    }

    const cmd = ['am', 'force-stop', packageName];
    const res = await this.exec(cmd, { onOutput });
    this.log('完成', `已成功強制停止 [${packageName}]`);
    return res;
  }

  /**
   * Check if an application has an available Profile hotspot data file
   * Uses multi-track detection:
   * 1. Direct profman dump & file read:
   *    - Runs `cmd package dump-profiles <packageName>`
   *    - Attempts `cat /data/misc/profman/<packageName>.txt`
   *    - If Permission denied occurs, attempts `su -c "cat ..."` if root is available
   * 2. Non-root fallback via `dumpsys package <packageName>`:
   *    - If accessing /data/misc/profman is blocked by SELinux / DAC (Permission denied),
   *      inspects dumpsys package dexopt state.
   *    - If status is `speed-profile` or reason contains `install-dm`/`profile`, Profile is active!
   *    - If status is `verify` or other, confirms no active profile and suggests `speed`.
   *
   * @param {string} packageName
   * @param {object} [options]
   * @param {string} [options.currentStatus]
   * @param {string} [options.currentReason]
   * @param {Function} [options.onOutput]
   * @returns {Promise<{ hasProfile: boolean, lineCount: number|null, source: string, detail: string, permissionDenied?: boolean }>}
   */
  async checkAppProfile(packageName, { currentStatus, currentReason, onOutput } = {}) {
    this.log('Profile 檢查', `正在檢查 [${packageName}] 之 Profile 熱點資料...`);

    if (this.isDemoMode) {
      return this._mockCheckAppProfile(packageName);
    }

    if (!this.adb) {
      throw new Error('裝置尚未連線。');
    }

    try {
      // Step 1: Force system to dump profile snapshot to /data/misc/profman/<packageName>.txt
      try {
        await this.exec(['cmd', 'package', 'dump-profiles', packageName], { onOutput });
      } catch (dumpErr) {
        // cmd package dump-profiles might fail on very old Android or restricted ROMs, continue to fallback
      }

      // Step 2: Read exported profile contents and count lines
      const catRes = await this.exec(['cat', `/data/misc/profman/${packageName}.txt`]);
      const stdout = (catRes.stdout || '').trim();
      const stderr = (catRes.stderr || '').trim();
      const combined = `${stdout}\n${stderr}`;

      const isPermissionDenied = combined.includes('Permission denied') || combined.includes('permission denied');
      const isNotFound = !isPermissionDenied && (!stdout || stdout.includes('No such file or directory') || stdout.includes('not found'));

      // If Permission denied, attempt root (su) read if available
      if (isPermissionDenied) {
        try {
          const suRes = await this.exec(['su', '-c', `cat /data/misc/profman/${packageName}.txt`]);
          const suOut = (suRes.stdout || '').trim();
          if (suOut && !suOut.includes('Permission denied') && !suOut.includes('not found') && !suOut.includes('No such file')) {
            const lines = suOut.split(/\r?\n/).filter((l) => l.trim().length > 0);
            const lineCount = lines.length;
            const hasProfile = lineCount > 0;
            this.log('Profile 檢查', `[${packageName}] (Root 模式) 成功讀取 Profile 檔案 (${lineCount} 行)`);
            return { hasProfile, lineCount, source: 'root_file', detail: `${lineCount} 行熱點代碼 (Root)` };
          }
        } catch {
          // su not supported, proceed to dumpsys fallback
        }

        // Non-root fallback: Inspect dumpsys package dexopt state
        let status = currentStatus;
        let reason = currentReason;
        let hasDmOrProfile = false;

        if (!status || status === 'unknown') {
          const dumpRes = await this.exec(['dumpsys', 'package', packageName]);
          const dumpOut = dumpRes.stdout || '';
          const parsed = parseSinglePackageDexopt(dumpOut);
          status = parsed.status;
          reason = parsed.reason;
          hasDmOrProfile = dumpOut.includes('install-dm') || /baselineProfileVersion/i.test(dumpOut) || /primary-profile/i.test(dumpOut);
        }

        const isSpeedProfile = status === 'speed-profile';
        const hasProfile = isSpeedProfile || hasDmOrProfile;

        if (hasProfile) {
          this.log('Profile 檢查', `[${packageName}] 受 Android SELinux 權限保護 (Permission denied)，已透過 dumpsys 備援判定：Profile 已生效 (狀態: ${status || 'speed-profile'})`);
          return {
            hasProfile: true,
            lineCount: null,
            source: 'dumpsys',
            detail: `Profile 已生效 (狀態: ${status || 'speed-profile'})`,
            permissionDenied: true,
          };
        } else {
          this.log('Profile 檢查', `[${packageName}] 受 Android SELinux 權限保護 (Permission denied)，系統當前狀態為 ${status || 'verify'} (未生效熱點，建議 speed 編譯)`);
          return {
            hasProfile: false,
            lineCount: 0,
            source: 'dumpsys',
            detail: `未發現生效 Profile (狀態: ${status || 'verify'})`,
            permissionDenied: true,
          };
        }
      }

      if (isNotFound) {
        // Double check dumpsys just in case it is already speed-profile
        let status = currentStatus;
        if (!status || status === 'unknown') {
          const dumpRes = await this.exec(['dumpsys', 'package', packageName]);
          const parsed = parseSinglePackageDexopt(dumpRes.stdout || '');
          status = parsed.status;
        }

        if (status === 'speed-profile') {
          this.log('Profile 檢查', `[${packageName}] 檔案未產生，但 dumpsys 狀態已確認為 speed-profile`);
          return {
            hasProfile: true,
            lineCount: null,
            source: 'dumpsys',
            detail: 'Profile 已生效 (speed-profile)',
          };
        }

        this.log('Profile 檢查', `[${packageName}] 未發現可用 Profile 檔案 (0 bytes 或不存在)`);
        return { hasProfile: false, lineCount: 0, source: 'file_not_found', detail: '未發現可用 Profile' };
      }

      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const lineCount = lines.length;
      const hasProfile = lineCount > 0;

      this.log('Profile 檢查', `[${packageName}] 檢查結果: ${hasProfile ? `有可用 Profile (${lineCount} 行)` : '無可用 Profile (0 行)'}`);
      return { hasProfile, lineCount, source: 'file', detail: `${lineCount} 行熱點代碼` };
    } catch (err) {
      this.log('警告', `[${packageName}] Profile 檢查失敗: ${err.message}`);
      return { hasProfile: false, lineCount: 0, error: err.message, source: 'error', detail: err.message };
    }
  }

  /* ---------------- Mock / Demo Methods for Instant Browser Testing ---------------- */

  async _mockCheckAppProfile(packageName) {
    await new Promise((r) => setTimeout(r, 200));
    const profileApps = {
      'com.google.android.chrome': 2840,
      'jp.naver.line.android': 1520,
      'com.android.chrome.beta': 1180,
      'com.google.android.youtube': 3410,
      'org.telegram.messenger': 890,
      'com.google.android.gm': 1250,
    };
    if (profileApps[packageName]) {
      const lineCount = profileApps[packageName];
      this.log('Profile 檢查', `[${packageName}] (示範模式) 檢測到 Profile (${lineCount} 行)`);
      return { hasProfile: true, lineCount };
    }
    this.log('Profile 檢查', `[${packageName}] (示範模式) 未檢測到 Profile (0 行)`);
    return { hasProfile: false, lineCount: 0 };
  }

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

  async _mockCompileApp(packageName, mode, { onOutput, force = true } = {}) {
    await new Promise((r) => setTimeout(r, 600));
    const output = `Compiling ${packageName} with mode=${mode}${force ? ' -f' : ''} ...\nSuccess\n`;
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
        hasProfile: true,
        profileLines: 2840,
        overrideMode: 'speed-profile',
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
        hasProfile: true,
        profileLines: 1520,
        overrideMode: 'speed-profile',
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
        hasProfile: true,
        profileLines: 1180,
        overrideMode: 'speed-profile',
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
        hasProfile: true,
        profileLines: 3410,
        overrideMode: 'speed-profile',
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
        hasProfile: false,
        profileLines: 0,
        overrideMode: 'speed',
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
        hasProfile: true,
        profileLines: 890,
        overrideMode: 'speed-profile',
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
        hasProfile: false,
        profileLines: 0,
        overrideMode: 'speed',
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
        hasProfile: false,
        profileLines: 0,
        overrideMode: 'speed',
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
        hasProfile: false,
        profileLines: 0,
        overrideMode: 'speed',
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
        hasProfile: false,
        profileLines: 0,
        overrideMode: 'speed',
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
        hasProfile: false,
        profileLines: 0,
        overrideMode: 'speed',
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
        hasProfile: true,
        profileLines: 1250,
        overrideMode: 'speed-profile',
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
