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
  parseSystemDexoptProps,
  formatCpuConfigSummary,
} from './parser.js';

/**
 * Build parameter-validated command array for AOT compilation
 * Protects against command injection and supports SDK 34+ (cmd art) and SDK <34 (cmd package).
 *
 * @param {string} packageName Target package name
 * @param {object} [options]
 * @param {string} [options.filter='speed'] Compilation filter (speed, speed-profile, everything, verify, etc.)
 * @param {string} [options.mode] Alias for filter
 * @param {string} [options.reason] Optional reason flag (-r <reason>), e.g. cmdline, bg-dexopt
 * @param {boolean|string} [options.checkProf] When false, appends --check-prof false
 * @param {boolean} [options.clearProfile=false] When true, appends -c to clear profile before compile
 * @param {string} [options.splitName] When specified, appends --split <splitName>
 * @param {boolean} [options.isSecondary=false] When true, appends --secondary-dex
 * @param {boolean} [options.force=true] When true, appends -f; when false, omits -f
 * @param {number} [sdkVersion=34] Android API SDK version
 * @returns {Array<string>} Command array suitable for adb execution
 */
export function buildCompileCommand(packageName, options = {}, sdkVersion = 33) {
  if (!packageName || typeof packageName !== 'string' || !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/.test(packageName.trim())) {
    throw new Error(`無效的套件名稱 (Invalid package name): "${packageName}"`);
  }
  const pkg = packageName.trim();

  const filter = (options.filter || options.mode || 'speed').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(filter)) {
    throw new Error(`無效的編譯模式 (Invalid compilation filter): "${filter}"`);
  }

  const reason = options.compilerReason || options.reason;
  if (reason && typeof reason === 'string') {
    if (!/^[a-zA-Z0-9_-]+$/.test(reason.trim())) {
      throw new Error(`無效的編譯原因 (Invalid compiler reason): "${reason}"`);
    }
  }

  const splitName = options.splitName || options.split;
  if (splitName && typeof splitName === 'string') {
    if (!/^[a-zA-Z0-9_\.\-]+$/.test(splitName.trim())) {
      throw new Error(`無效的 Split 模組名稱 (Invalid split name): "${splitName}"`);
    }
  }

  const baseCmd = (sdkVersion >= 34 && options.usePackageService !== true)
    ? ['cmd', 'art', 'compile']
    : ['cmd', 'package', 'compile'];

  const compileCmd = [...baseCmd];

  if (options.clearProfile) {
    compileCmd.push('-c');
  }

  compileCmd.push('-m', filter);

  if (reason) {
    compileCmd.push('-r', reason.trim());
  }

  const force = options.force !== false;
  if (force) {
    compileCmd.push('-f');
  }

  if (options.checkProfFalse || options.checkProf === false || options.checkProf === 'false') {
    compileCmd.push('--check-prof', 'false');
  }

  if (splitName) {
    compileCmd.push('--split', splitName.trim());
  }

  if (options.isSecondary) {
    compileCmd.push('--secondary-dex');
  }

  compileCmd.push(pkg);
  return compileCmd;
}

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
    const sdkStr = await this.getDeviceProp('ro.build.version.sdk', '34');
    const sdk = parseInt(sdkStr, 10) || 34;

    this.deviceInfo = {
      model,
      release,
      brand,
      sdk,
      serial: device.serial || 'USB-Device',
      title: `${model} (Android ${release})`,
    };

    // Probe if ART service exists on Android 14+
    this._supportsArtService = undefined;
    if (sdk >= 34) {
      try {
        const checkArt = await this.exec(['cmd', 'art', '--version']);
        const combined = `${checkArt?.stdout || ''} ${checkArt?.stderr || ''}`.toLowerCase();
        if (checkArt?.exitCode !== 0 || combined.includes("can't find service") || combined.includes('cannot find service')) {
          this._supportsArtService = false;
        } else {
          this._supportsArtService = true;
        }
      } catch {
        this._supportsArtService = false;
      }
    }

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
      sdk: 34,
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
  async exec(commandArray, { onOutput, signal } = {}) {
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
      const process = await spawner.spawn(commandArray, signal);
      this.currentProcess = process;
      
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

      try {
        const stdoutStream = process.stdout ?? process.output;
        const [stdout, stderr] = await Promise.all([
          readStream(stdoutStream, false),
          readStream(process.stderr, true),
        ]);

        const rawExitCode = typeof process.exited === 'number' ? process.exited : await process.exited;
        const exitCode = typeof rawExitCode === 'number' ? rawExitCode : 0;
        return { stdout, stderr, exitCode };
      } catch (err) {
        if (this._batchCancelled || signal?.aborted) {
          return { stdout: '', stderr: 'Cancelled', exitCode: 130 };
        }
        throw err;
      } finally {
        this.currentProcess = null;
      }
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
   * Build compile command targeting current device SDK
   */
  buildCompileCommand(packageName, options = {}) {
    const sdk = typeof options.sdkVersion === 'number' ? options.sdkVersion : (this.deviceInfo?.sdk || 34);
    return buildCompileCommand(packageName, options, sdk);
  }

  /**
   * Optimize a single package with specified options (PLAN.md Section 1 & 5)
   * Supports: filter, reason, checkProf, clearProfile, splitName, isSecondary, force, etc.
   * Handles SDK >= 34 (cmd art) with automatic fallback to cmd package and pm.
   *
   * @param {string} packageName
   * @param {object} [options]
   * @param {string} [options.filter='speed']
   * @param {string} [options.mode]
   * @param {string} [options.reason]
   * @param {boolean|string} [options.checkProf]
   * @param {boolean} [options.clearProfile=false]
   * @param {string} [options.splitName]
   * @param {boolean} [options.isSecondary=false]
   * @param {boolean} [options.force=true]
   * @param {boolean} [options.skipQueryStatus=false]
   * @param {boolean} [options.autoSecondaryDex=true]
   * @param {object} [options.appInfo]
   * @param {Function} [options.onOutput]
   */
  async compilePackage(packageName, options = {}) {
    const filter = options.filter || options.mode || 'speed';
    const force = options.force !== false;
    const sdk = typeof options.sdkVersion === 'number'
      ? options.sdkVersion
      : (this._supportsArtService === false ? 33 : (this.deviceInfo?.sdk || 33));

    const compileReason = options.compilerReason || options.reason;
    const splitTarget = options.splitName || options.split;

    this.log('最佳化', `正在編譯 [${packageName}] (模式: ${filter}${compileReason ? `, 原因: ${compileReason}` : ''}${force ? ', 強制 -f' : ', 快速/無 -f'}${options.clearProfile ? ', 清空 Profile' : ''}${options.checkProfFalse || options.checkProf === false || options.checkProf === 'false' ? ', 略過 Profile 差異檢查' : ''}${splitTarget ? `, Split: ${splitTarget}` : ''})...`);

    if (this.isDemoMode) {
      return this._mockCompilePackage(packageName, { ...options, filter, force, reason: compileReason, splitName: splitTarget });
    }

    // cmd package compile -m <mode> [-f] <package>
    const compileCmd = buildCompileCommand(packageName, { ...options, filter, force, usePackageService: this._supportsArtService === false }, sdk);
    /*
    if (force) {
      compileCmd.push('-f');
    }
    */

    let res;
    let shouldFallbackPackage = false;
    let shouldFallbackPm = false;

    try {
      res = await this.exec(compileCmd, { onOutput: options.onOutput });
      if (res && res.exitCode !== 0) {
        const combined = `${res.stdout || ''} ${res.stderr || ''}`.toLowerCase();
        if (compileCmd[1] === 'art') {
          // If cmd art failed for ANY reason (e.g. Can't find service: art, exitCode != 0), fallback to cmd package
          shouldFallbackPackage = true;
          this._supportsArtService = false;
        } else if (compileCmd[1] === 'package') {
          if (combined.includes('not found') || combined.includes('inaccessible') || combined.includes("can't find service") || res.exitCode === 127) {
            shouldFallbackPm = true;
          }
        }
      } else if (compileCmd[1] === 'art') {
        this._supportsArtService = true;
      }
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (compileCmd[1] === 'art') {
        shouldFallbackPackage = true;
        this._supportsArtService = false;
      } else if (msg.includes('not found') || msg.includes('cmd') || msg.includes("can't find service")) {
        shouldFallbackPm = true;
      } else {
        throw err;
      }
    }

    if (shouldFallbackPackage) {
      this.log('警告', 'cmd art compile 在此裝置無法使用 (Can\'t find service: art)，自動備援改用標準 cmd package compile...');
      const fallbackCmd = buildCompileCommand(packageName, { ...options, filter, force, usePackageService: true }, 33);
      try {
        res = await this.exec(fallbackCmd, { onOutput: options.onOutput });
        if (res && res.exitCode !== 0) {
          const combined = `${res.stdout || ''} ${res.stderr || ''}`.toLowerCase();
          if (combined.includes('not found') || combined.includes('inaccessible') || combined.includes("can't find service") || res.exitCode === 127) {
            shouldFallbackPm = true;
          }
        }
      } catch (err2) {
        const msg2 = (err2.message || '').toLowerCase();
        if (msg2.includes('not found') || msg2.includes('cmd') || msg2.includes("can't find service")) {
          shouldFallbackPm = true;
        } else {
          throw err2;
        }
      }
    }

    if (shouldFallbackPm) {
      this.log('警告', 'cmd package 失敗或不存在，自動備援改用舊版 pm compile...');
      const pmCmd = ['pm', 'compile'];
      if (options.clearProfile) pmCmd.push('-c');
      pmCmd.push('-m', filter);
      if (compileReason) pmCmd.push('-r', compileReason.trim());
      if (force) pmCmd.push('-f');
      if (options.checkProfFalse || options.checkProf === false || options.checkProf === 'false') pmCmd.push('--check-prof', 'false');
      if (splitTarget) pmCmd.push('--split', splitTarget.trim());
      if (options.isSecondary) pmCmd.push('--secondary-dex');
      pmCmd.push(packageName);
      res = await this.exec(pmCmd, { onOutput: options.onOutput });
    }

    if (res && res.exitCode !== 0 && !options.skipThrowOnError) {
      const errMsg = (res.stderr || res.stdout || `Exit code ${res.exitCode}`).trim();
      throw new Error(`編譯指令執行失敗: ${errMsg}`);
    }

    // Auto-compile secondary DEX if optimizable items exist (Issue #9 Problem 2)
    const autoSecondary = options.autoSecondaryDex !== false;
    if (autoSecondary && !splitTarget && !options.isSecondary && (options.appInfo?.hasOptimizableSecondaryDex || options.appInfo?.secondaryDexSummary?.optimizableCount > 0)) {
      this.log('最佳化', `正在最佳化 [${packageName}] 之次要 DEX (--secondary-dex，模式: speed)...`);
      const secSdk = (this._supportsArtService === false) ? 33 : sdk;
      const secCmd = buildCompileCommand(packageName, { filter: 'speed', force, isSecondary: true, usePackageService: this._supportsArtService === false }, secSdk);
      try {
        await this.exec(secCmd, { onOutput: options.onOutput });
      } catch (secErr) {
        this.log('警告', `[${packageName}] --secondary-dex 編譯略過或受限: ${secErr.message}`);
      }
    }

    if (options.skipQueryStatus) {
      this.log('完成', `[${packageName}] 編譯指令已送出 (批次模式略過單一 dumpsys 查詢)`);
      return {
        status: filter,
        reason: options.reason || 'cmdline',
        hasCode: true,
      };
    }

    // Partial re-query with dumpsys package <packageName>
    this.log('狀態更新', `重新擷取 [${packageName}] 之最新狀態...`);
    const dumpRes = await this.exec(['dumpsys', 'package', packageName]);
    const updated = parseSinglePackageDexopt(dumpRes.stdout, packageName);

    // Safety fallback: if command execution succeeded, never degrade a valid app to N/A / no-code
    if (updated.status === 'unknown' || updated.status === 'N/A') {
      updated.status = filter;
      updated.reason = options.reason || 'cmdline';
      updated.hasCode = true;
    }

    this.log('完成', `[${packageName}] 已更新為 status=${updated.status} reason=${updated.reason}`);
    return updated;
  }

  /**
   * Optimize a single app with specified mode (Backward compatibility layer)
   * @param {string} packageName
   * @param {'speed'|'speed-profile'|'everything'|object} mode
   * @param {object} [options]
   * @param {boolean} [options.skipQueryStatus=false] - When true, skips dumpsys package re-query (for batch processing)
   * @param {boolean} [options.force=true] - When true, adds -f flag to force compilation; when false, compiles without -f (fast mode)
   * @param {boolean} [options.autoSecondaryDex=true] - When true, automatically compiles secondary DEX if optimizable items exist
   * @param {object} [options.appInfo] - Optional app record containing secondaryDex information
   * @param {Function} [options.onOutput]
   */
  async compileApp(packageName, mode = 'speed', { onOutput, skipQueryStatus = false, force = true, autoSecondaryDex = true, appInfo, ...extraOptions } = {}) {
    if (typeof mode === 'object' && mode !== null) {
      return this.compilePackage(packageName, { onOutput, skipQueryStatus, force, autoSecondaryDex, appInfo, ...mode });
    }
    return this.compilePackage(packageName, { filter: mode, onOutput, skipQueryStatus, force, autoSecondaryDex, appInfo, ...extraOptions });
  }

  /**
   * Read dalvik.vm and pm.dexopt system properties
   * @returns {Promise<object>} Parsed properties object
   */
  async getDexoptSystemProps() {
    this.log('裝置資訊', '正在擷取系統 dex2oat 與 ART 調度屬性 (getprop)...');
    let rawOutput = '';
    if (this.isDemoMode) {
      rawOutput = this._mockGetDexoptSystemProps();
    } else {
      if (!this.adb) throw new Error('裝置尚未連線。');
      try {
        const res = await this.exec(['getprop']);
        rawOutput = res?.stdout || '';
      } catch (err) {
        this.log('警告', `getprop 讀取失敗: ${err.message}`);
      }
    }
    const parsed = parseSystemDexoptProps(rawOutput);
    this.systemDexoptProps = parsed;
    this.log('裝置資訊', `已成功讀取 ART 屬性: ${parsed.summary}`);
    return parsed;
  }

  /**
   * Check if device has root access (su -c id => uid=0)
   * @returns {Promise<{ hasRoot: boolean, uid: number|null, isDemo?: boolean, message: string }>}
   */
  async checkRootAccess() {
    this.log('Root 檢查', '正在探測裝置是否具備 Root 權限 (su -c id)...');
    if (this.isDemoMode) {
      this.log('Root 檢查', '示範模式：已模擬取得 Root 專家級權限 (uid=0)。');
      return { hasRoot: true, uid: 0, isDemo: true, message: '示範模式已模擬取得 Root 權限 (uid=0)' };
    }

    if (!this.adb) {
      throw new Error('裝置尚未連線。');
    }

    try {
      const res = await this.exec(['su', '-c', 'id']);
      const out = `${res?.stdout || ''} ${res?.stderr || ''}`.trim();
      const hasRoot = /uid=0\(root\)/i.test(out) || /uid=0\b/.test(out);
      if (hasRoot) {
        this.log('Root 檢查', '驗證成功：已取得 Root 權限 (uid=0)。');
        return { hasRoot: true, uid: 0, message: '已取得 Root 專家級權限 (uid=0)' };
      }
      this.log('Root 檢查', `裝置未取得 Root 權限: ${out}`);
      return { hasRoot: false, uid: null, message: '裝置未取得 Root 權限 (非 uid=0)' };
    } catch (err) {
      this.log('Root 檢查', `Root 探測失敗或無 su 二進位檔: ${err.message}`);
      return { hasRoot: false, uid: null, message: err.message };
    }
  }

  /**
   * Back up current dalvik.vm dex2oat properties before applying Root adjustments
   * @returns {Promise<object>}
   */
  async backupDex2oatProps() {
    const backup = {
      threads: await this.getDeviceProp('dalvik.vm.dex2oat-threads', ''),
      cpuSet: await this.getDeviceProp('dalvik.vm.dex2oat-cpu-set', ''),
      flags: await this.getDeviceProp('dalvik.vm.dex2oat-flags', ''),
      timestamp: Date.now(),
    };
    this._rootPropsBackup = backup;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('dexopt_root_backup', JSON.stringify(backup));
      } catch {
        // ignore
      }
    }
    return backup;
  }

  /**
   * Apply custom dex2oat props via Root (su -c setprop)
   * @param {object} config
   * @param {number|string} [config.threads]
   * @param {string} [config.cpuSet]
   * @param {string} [config.extraFlags]
   */
  async applyCustomDex2oatProps(config = {}) {
    if (!this._rootPropsBackup) {
      await this.backupDex2oatProps();
    }

    this.log('Root 調校', '正在透過 su 動態套用 dex2oat 編譯器參數...');

    if (config.threads !== undefined && config.threads !== null && config.threads !== '') {
      const threadsNum = parseInt(config.threads, 10);
      if (isNaN(threadsNum) || threadsNum < 1 || threadsNum > 32) {
        throw new Error(`無效的執行緒數量 (Threads must be 1-32): ${config.threads}`);
      }
      if (this.isDemoMode) {
        this.log('Root 調校', `[Demo] setprop dalvik.vm.dex2oat-threads ${threadsNum}`);
      } else {
        await this.exec(['su', '-c', `setprop dalvik.vm.dex2oat-threads ${threadsNum}`]);
      }
    }

    if (config.cpuSet !== undefined && config.cpuSet !== null && config.cpuSet !== '') {
      const cpuSetStr = String(config.cpuSet).trim();
      if (!/^[0-9,\-]+$/.test(cpuSetStr)) {
        throw new Error(`無效的 CPU 親和力遮罩 (Invalid cpu-set): "${cpuSetStr}"`);
      }
      if (this.isDemoMode) {
        this.log('Root 調校', `[Demo] setprop dalvik.vm.dex2oat-cpu-set ${cpuSetStr}`);
      } else {
        await this.exec(['su', '-c', `setprop dalvik.vm.dex2oat-cpu-set ${cpuSetStr}`]);
      }
    }

    if (config.extraFlags !== undefined && config.extraFlags !== null && config.extraFlags !== '') {
      const flagsStr = String(config.extraFlags).trim();
      if (/[;&|`<>$]/.test(flagsStr)) {
        throw new Error(`額外旗標包含不安全字元 (Unsafe characters in extra flags): "${flagsStr}"`);
      }
      if (this.isDemoMode) {
        this.log('Root 調校', `[Demo] setprop dalvik.vm.dex2oat-flags "${flagsStr}"`);
      } else {
        await this.exec(['su', '-c', `setprop dalvik.vm.dex2oat-flags "${flagsStr}"`]);
      }
    }

    this.log('Root 調校', '已成功套用 Root 專家級 dex2oat 參數。');
    return true;
  }

  /**
   * Restore dex2oat properties to initial backup state
   * @param {object} [backup]
   */
  async restoreDex2oatProps(backup = null) {
    const toRestore = backup || this._rootPropsBackup || (() => {
      if (typeof localStorage !== 'undefined') {
        try {
          const saved = localStorage.getItem('dexopt_root_backup');
          return saved ? JSON.parse(saved) : null;
        } catch {
          return null;
        }
      }
      return null;
    })();

    if (!toRestore) {
      this.log('Root 還原', '無先前備份之屬性紀錄，略過還原。');
      return false;
    }

    this.log('Root 還原', '正在還原原始 dalvik.vm 屬性設定...');
    const commands = [];
    if (toRestore.threads !== undefined) {
      commands.push(['su', '-c', `setprop dalvik.vm.dex2oat-threads "${toRestore.threads || ''}"`]);
    }
    if (toRestore.cpuSet !== undefined) {
      commands.push(['su', '-c', `setprop dalvik.vm.dex2oat-cpu-set "${toRestore.cpuSet || ''}"`]);
    }
    if (toRestore.flags !== undefined) {
      commands.push(['su', '-c', `setprop dalvik.vm.dex2oat-flags "${toRestore.flags || ''}"`]);
    }

    if (this.isDemoMode) {
      this.log('Root 還原', '[Demo] 已成功還原原始 dex2oat 屬性設定。');
    } else {
      for (const cmd of commands) {
        try {
          await this.exec(cmd);
        } catch (e) {
          this.log('警告', `還原屬性失敗: ${e.message}`);
        }
      }
    }

    this._rootPropsBackup = null;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('dexopt_root_backup');
      } catch {
        // ignore
      }
    }
    this.log('Root 還原', '系統屬性已安全還原完畢。');
    return true;
  }

  /**
   * Optimize all applications on device using -f -a (Issue #7)
   * Executes `cmd package compile -m <mode> -f -a`
   * @param {'speed'|'speed-profile'} mode
   * @param {object} [options]
   * @param {function} [options.onOutput]
   * @param {AbortSignal} [options.signal]
   */
  async compileAll(mode = 'speed', { onOutput = () => {}, signal } = {}) {
    this._batchCancelled = false;
    this.log('全機最佳化', `正在對全機所有應用程式執行 ${mode} 編譯 (cmd package compile -m ${mode} -f -a)...`);
    
    if (this.isDemoMode) {
      return this._mockCompileAll(mode, { onOutput });
    }

    let res;
    let shouldFallback = false;
    try {
      res = await this.exec(['cmd', 'package', 'compile', '-m', mode, '-f', '-a'], { onOutput, signal });
      if (res && res.exitCode !== 0) {
        const combined = `${res.stdout || ''} ${res.stderr || ''}`.toLowerCase();
        if (combined.includes('not found') || combined.includes('inaccessible or not found') || res.exitCode === 127) {
          shouldFallback = true;
        }
      }
    } catch (err) {
      if (this._batchCancelled || signal?.aborted) {
        throw err;
      }
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('not found') || msg.includes('cmd')) {
        shouldFallback = true;
      } else {
        throw err;
      }
    }

    if (shouldFallback && !this._batchCancelled && !signal?.aborted) {
      this.log('警告', 'cmd package 失敗或不存在，改用舊版 pm compile 指令備援...');
      return await this.exec(['pm', 'compile', '-m', mode, '-f', '-a'], { onOutput, signal });
    }

    return res;
  }

  /**
   * Cancel active batch compile process (both real and demo modes)
   */
  cancelBatchCompile() {
    this._batchCancelled = true;
    if (this.currentProcess) {
      try {
        this.currentProcess.kill?.();
      } catch (e) {
        // ignore
      }
      this.currentProcess = null;
    }
    this.log('全機最佳化', '已下達中斷批次最佳化指令。');
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
      // Step 1: Force system to dump profile snapshot to profman text file
      let dumpOutputText = '';
      try {
        const dumpRes = await this.exec(['cmd', 'package', 'dump-profiles', packageName], {
          onOutput: (chunk, isErr) => {
            dumpOutputText += chunk;
            onOutput?.(chunk, isErr);
          },
        });
        dumpOutputText += `${dumpRes?.stdout || ''}\n${dumpRes?.stderr || ''}`;
      } catch (dumpErr) {
        // cmd package dump-profiles might fail on very old Android or restricted ROMs, continue to fallback
      }

      // Extract file paths from dump-profiles output (e.g. "Profile saved to '/data/misc/profman/<pkg>-primary.prof.txt'")
      const savedMatches = [];
      const regex = /Profile saved to '([^']+)'/gi;
      let m;
      while ((m = regex.exec(dumpOutputText)) !== null) {
        if (m[1]) savedMatches.push(m[1].trim());
      }

      // Build prioritized list of candidate paths to inspect
      const candidatePaths = new Set([
        ...savedMatches,
        `/data/misc/profman/${packageName}-primary.prof.txt`,
        `/data/misc/profman/${packageName}.txt`,
        `/data/misc/profman/${packageName}.prof.txt`,
        `/data/misc/profman/${packageName}.primary.prof.txt`,
      ]);

      let totalLineCount = 0;
      let fileFound = false;
      let permissionDenied = false;
      const pathsToTry = savedMatches.length > 0 ? savedMatches : Array.from(candidatePaths);

      for (const filePath of pathsToTry) {
        try {
          const catRes = await this.exec(['cat', filePath]);
          const stdout = (catRes.stdout || '').trim();
          const stderr = (catRes.stderr || '').trim();
          const combined = `${stdout}\n${stderr}`;

          if (combined.includes('Permission denied') || combined.includes('permission denied')) {
            permissionDenied = true;
            // Attempt root (su) read if available
            try {
              const suRes = await this.exec(['su', '-c', `cat ${filePath}`]);
              const suOut = (suRes.stdout || '').trim();
              if (suOut && !suOut.includes('Permission denied') && !suOut.includes('not found') && !suOut.includes('No such file')) {
                const lines = suOut.split(/\r?\n/).filter((l) => l.trim().length > 0);
                totalLineCount += lines.length;
                fileFound = true;
              }
            } catch {
              // su not available
            }
          } else if (stdout && !stdout.includes('No such file or directory') && !stdout.includes('not found')) {
            const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
            totalLineCount += lines.length;
            fileFound = true;
            // If scanning candidates without exact savedMatches and found valid lines, that's our match
            if (savedMatches.length === 0 && lines.length > 0) {
              break;
            }
          }
        } catch {
          // ignore error for single candidate file
        }
      }

      // Case 1: Successfully read profile file(s)
      if (fileFound) {
        const hasProfile = totalLineCount > 0;
        this.log('Profile 檢查', `[${packageName}] 檢查結果: ${hasProfile ? `有可用 Profile (${totalLineCount} 行)` : 'Profile 檔案為空 (0 行)'}`);
        return {
          hasProfile,
          lineCount: totalLineCount,
          source: permissionDenied ? 'root_file' : 'file',
          detail: `${totalLineCount} 行熱點代碼`,
        };
      }

      // Case 2: Encountered Permission denied on non-root device
      if (permissionDenied) {
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

      // Case 3: File not found, check dumpsys fallback
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

      this.log('Profile 檢查', `[${packageName}] 未發現可用 Profile 檔案 (未產生熱點或尚未由系統記錄)`);
      return { hasProfile: false, lineCount: 0, source: 'file_not_found', detail: '未發現可用 Profile' };
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

  async _mockCompileApp(packageName, mode, { onOutput, force = true, autoSecondaryDex = true, appInfo, ...options } = {}) {
    return this._mockCompilePackage(packageName, { filter: mode, onOutput, force, autoSecondaryDex, appInfo, ...options });
  }

  async _mockCompilePackage(packageName, options = {}) {
    const filter = options.filter || options.mode || 'speed';
    const force = options.force !== false;
    await new Promise((r) => setTimeout(r, 600));

    let output = `Compiling ${packageName} with filter=${filter}${options.reason ? ` reason=${options.reason}` : ''}${force ? ' -f' : ''}${options.clearProfile ? ' -c' : ''}${options.checkProf === false || options.checkProf === 'false' ? ' --check-prof false' : ''}${options.splitName ? ` --split ${options.splitName}` : ''} ...\nSuccess\n`;

    if (options.autoSecondaryDex && (options.appInfo?.hasOptimizableSecondaryDex || options.appInfo?.secondaryDexSummary?.optimizableCount > 0)) {
      output += `Compiling secondary dex for ${packageName} with mode=speed${force ? ' -f' : ''} --secondary-dex ...\nSuccess\n`;
    }
    options.onOutput?.(output, false);

    const splits = (options.appInfo?.splits || []).map((s) => {
      if (options.splitName && (s.name === options.splitName || s.fileName === options.splitName || s.splitName === options.splitName)) {
        return { ...s, status: filter, reason: options.reason || 'cmdline' };
      }
      return s;
    });

    return {
      status: options.splitName ? (options.appInfo?.status || filter) : filter,
      reason: options.reason || 'cmdline',
      hasCode: true,
      splits,
      secondaryDex: (options.appInfo?.secondaryDex || []).map((s) => ({
        ...s,
        status: s.isUnsupportedContext || s.isRemoved ? s.status : 'speed',
        isOptimizable: false,
      })),
      hasSecondaryDex: options.appInfo?.hasSecondaryDex || false,
      hasOptimizableSecondaryDex: false,
      secondaryDexSummary: options.appInfo?.secondaryDexSummary ? {
        ...options.appInfo.secondaryDexSummary,
        optimizableCount: 0,
        compiledCount: options.appInfo.secondaryDexSummary.total - options.appInfo.secondaryDexSummary.restrictedCount,
      } : null,
    };
  }

  _mockGetDexoptSystemProps() {
    return `
[dalvik.vm.dex2oat-threads]: [8]
[dalvik.vm.dex2oat-cpu-set]: [0,1,2,3,4,5,6,7]
[dalvik.vm.bg-dexopt.threads]: [4]
[dalvik.vm.bg-dexopt.cpu-set]: [0,1,2,3]
[dalvik.vm.boot-dex2oat-threads]: [8]
[dalvik.vm.boot-dex2oat-cpu-set]: [0,1,2,3,4,5,6,7]
[dalvik.vm.image-dex2oat-threads]: [8]
[dalvik.vm.dex2oat-flags]: [--no-generate-mini-debug-info]
[dalvik.vm.dex2oat-filter]: [speed-profile]
[pm.dexopt.bg-dexopt]: [speed-profile]
[pm.dexopt.cmdline]: [speed]
[pm.dexopt.first-boot]: [verify]
[pm.dexopt.install]: [speed-profile]
[pm.dexopt.boot-after-ota]: [verify]
[pm.dexopt.inactive]: [verify]
    `.trim();
  }

  async _mockCompileAll(mode, { onOutput } = {}) {
    this._batchCancelled = false;
    this.log('模擬模式', `開始執行模擬之全機最佳化 (cmd package compile -m ${mode} -f -a)...`);
    const steps = [
      `[cmd package compile -m ${mode} -f -a]: 正在對系統與使用者所有套件進行原生批次編譯...`,
      `Compiling: com.google.android.chrome [status=${mode}]`,
      `Compiling: jp.naver.line.android [status=${mode}]`,
      `Compiling: com.android.chrome.beta [status=${mode}]`,
      `Compiling: com.google.android.youtube [status=${mode}]`,
      `Compiling: com.google.android.apps.maps [status=${mode}]`,
      `Compiling: com.google.android.calendar [status=${mode}]`,
      `Compiling: com.google.android.gm [status=${mode}]`,
      `Compilation finished for all packages. dexopt completed successfully.`,
    ];
    for (const step of steps) {
      if (this._batchCancelled) {
        onOutput?.('\n⚠️ 模擬全機批次編譯已由使用者中斷。\n', true);
        return { stdout: 'Cancelled', stderr: '', exitCode: 130 };
      }
      await new Promise((r) => setTimeout(r, 350));
      this.log('全機 AOT', step);
      onOutput?.(step + '\n', false);
    }
    return { stdout: 'Success\n', stderr: '', exitCode: 0 };
  }

  async _getDemoApps({ onProgress }) {
    onProgress?.({ phase: 1, message: '正在讀取示範套件資料...' });
    await new Promise((r) => setTimeout(r, 300));
    onProgress?.({ phase: 2, message: '正在整理分類...' });
    await new Promise((r) => setTimeout(r, 200));

    // High quality demo data faithfully reflecting the screenshots and Issue #9 scenarios
    const frequentlyUsed = [
      {
        packageName: 'com.google.android.chrome',
        displayName: 'Google Chrome',
        path: '/data/app/com.google.android.chrome/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '2h 45m',
        priorityScore: 2.85,
        rankingScore: 3.20,
        splits: [],
        secondaryDex: [],
        hasSecondaryDex: false,
      },
      {
        packageName: 'jp.naver.line.android',
        displayName: 'LINE',
        path: '/data/app/jp.naver.line.android/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '1h 30m',
        priorityScore: 2.40,
        rankingScore: 2.75,
        splits: [],
        secondaryDex: [
          {
            path: '/data/user/0/jp.naver.line.android/app_pccache/5/pcam.jar',
            status: 'verify',
            reason: 'vdex',
            isUnsupportedContext: true,
            isRemoved: false,
            isOptimizable: false,
          },
          {
            path: '/data/user/0/jp.naver.line.android/app_pccache/5/pcam2.jar',
            status: 'verify',
            reason: 'vdex',
            isUnsupportedContext: true,
            isRemoved: false,
            isOptimizable: false,
          },
        ],
        hasSecondaryDex: true,
        hasOptimizableSecondaryDex: false,
        secondaryDexSummary: {
          total: 2,
          optimizableCount: 0,
          restrictedCount: 2,
          compiledCount: 0,
        },
      },
      {
        packageName: 'com.android.chrome.beta',
        displayName: 'Lunch Chrome',
        path: '/data/app/com.android.chrome.beta/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '54m',
        priorityScore: 2.15,
        rankingScore: 2.50,
        splits: [],
        secondaryDex: [],
        hasSecondaryDex: false,
      },
      {
        packageName: 'com.google.android.youtube',
        displayName: 'YouTube',
        path: '/data/app/com.google.android.youtube/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '48m',
        priorityScore: 2.05,
        rankingScore: 2.40,
        splits: [
          {
            name: 'split_config.arm64_v8a.apk',
            path: '/data/app/com.google.android.youtube/split_config.arm64_v8a.apk',
            status: 'speed-profile',
            reason: 'bg-dexopt',
          },
        ],
        secondaryDex: [],
        hasSecondaryDex: false,
      },
      {
        packageName: 'com.google.android.apps.maps',
        displayName: 'Google Maps',
        path: '/data/app/com.google.android.apps.maps/base.apk',
        isSystem: false,
        status: 'speed',
        reason: 'cmdline',
        hasCode: true,
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '35m',
        priorityScore: 1.82,
        rankingScore: 2.17,
      },
      {
        packageName: 'org.telegram.messenger',
        displayName: 'Telegram',
        path: '/data/app/org.telegram.messenger/base.apk',
        isSystem: false,
        status: 'speed-profile',
        reason: 'bg-dexopt',
        hasCode: true,
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
        isCannotAot: false,
        tier: 'frequently_used',
        usageTimeFormatted: '22m',
        priorityScore: 1.54,
        rankingScore: 1.89,
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
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
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
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
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
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
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
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
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
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
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
        hasProfile: undefined,
        profileLines: 0,
        overrideMode: undefined,
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
