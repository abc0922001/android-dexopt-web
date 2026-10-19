/**
 * Android Dexopt Web - ADB Output Parser & Categorization Engine
 */

/**
 * Parse output of `pm list packages -f`
 * Example format:
 * package:/data/app/~~ab==/com.google.android.youtube-cd==/base.apk=com.google.android.youtube
 * package:/system/priv-app/Settings/Settings.apk=com.android.settings
 * 
 * @param {string} text
 * @returns {Map<string, { packageName: string, path: string, isSystem: boolean }>}
 */
export function parsePackageList(text) {
  const result = new Map();
  if (!text) return result;

  const lines = text.split(/\r?\n/);
  const regex = /^package:(?<path>.+?)=(?<pkg>[a-zA-Z0-9_\.]+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(regex);
    if (match && match.groups) {
      const { path, pkg } = match.groups;
      const isSystem = !path.startsWith('/data/app/') && !path.startsWith('/data/user/');
      result.set(pkg, {
        packageName: pkg,
        path,
        isSystem,
      });
    }
  }

  return result;
}

/**
/**
 * Parse time duration string (e.g. "123456", "01:23:45", "1h20m") to milliseconds
 * @param {string} val
 * @returns {number}
 */
export function parseDurationToMs(val) {
  if (!val) return 0;
  val = String(val).trim();

  // If purely digits, it's milliseconds
  if (/^\d+$/.test(val)) {
    return parseInt(val, 10);
  }

  // If ends with ms (e.g. "12345ms")
  const msMatch = val.match(/^(\d+)\s*ms$/i);
  if (msMatch) {
    return parseInt(msMatch[1], 10);
  }

  // If HH:MM:SS or MM:SS
  if (val.includes(':')) {
    const parts = val.split(':').map((p) => parseInt(p, 10) || 0);
    if (parts.length === 3) {
      return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    } else if (parts.length === 2) {
      return (parts[0] * 60 + parts[1]) * 1000;
    }
  }

  // If human readable: 1h23m or 45s (ensure m doesn't match ms)
  let ms = 0;
  const hMatch = val.match(/(\d+)\s*h/i);
  const mMatch = val.match(/(\d+)\s*m(?!s)/i);
  const sMatch = val.match(/(\d+)\s*s/i);

  if (hMatch) ms += parseInt(hMatch[1], 10) * 3600000;
  if (mMatch) ms += parseInt(mMatch[1], 10) * 60000;
  if (sMatch) ms += parseInt(sMatch[1], 10) * 1000;

  return ms;
}

/**
 * Format milliseconds into human-readable duration (e.g. "1h 25m", "15m")
 * @param {number} ms
 * @returns {string}
 */
export function formatUsageDuration(ms) {
  if (!ms || ms < 60000) return '';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return `${mins}m`;
}

/**
 * Check if a package is a known resource overlay, config, cutout, navbar, or shim package without DEX code
 * @param {string} pkg
 * @returns {boolean}
 */
export function isNoCodeOrOverlayPackage(pkg) {
  if (!pkg || typeof pkg !== 'string') return false;
  const lower = pkg.toLowerCase();
  return (
    lower.endsWith('.overlay') ||
    lower.includes('.overlay.') ||
    lower.endsWith('gxoverlay') ||
    lower.includes('.auto_generated_rro_') ||
    lower.includes('.auto_generated_characteristics_rro') ||
    lower.endsWith('.config') ||
    lower.includes('.config.') ||
    lower.endsWith('.ctsshim') ||
    lower.includes('.ctsshim.') ||
    lower.startsWith('com.android.internal.display.cutout.emulation.') ||
    lower.startsWith('com.android.internal.systemui.navbar.')
  );
}

/**
 * Parse output of `dumpsys usagestats`
 * Extracts packages that have recorded foreground time across multiple intervals:
 * daily, weekly, monthly, and yearly stats.
 * Computes a weighted recent activity score and prioritizes weekly stats for card display.
 * 
 * @param {string} text
 * @returns {Map<string, { foregroundMs: number, weeklyMs: number, monthlyMs: number, dailyMs: number, yearlyMs: number, weightedScore: number }>}
 */
export function parseUsageStats(text) {
  const usageMap = new Map();
  if (!text) return usageMap;

  const lines = text.split(/\r?\n/);
  let currentSection = 'unknown'; // 'daily' | 'weekly' | 'monthly' | 'yearly' | 'unknown'

  const getOrCreate = (pkg) => {
    if (!usageMap.has(pkg)) {
      usageMap.set(pkg, {
        packageName: pkg,
        foregroundMs: 0,
        weeklyMs: 0,
        monthlyMs: 0,
        dailyMs: 0,
        yearlyMs: 0,
        weightedScore: 0,
      });
    }
    return usageMap.get(pkg);
  };

  for (const line of lines) {
    // Detect interval headers in dumpsys usagestats
    if (/In-memory\s+daily\s+stats/i.test(line) || /Daily\s+stats/i.test(line)) {
      currentSection = 'daily';
      continue;
    } else if (/In-memory\s+weekly\s+stats/i.test(line) || /Weekly\s+stats/i.test(line)) {
      currentSection = 'weekly';
      continue;
    } else if (/In-memory\s+monthly\s+stats/i.test(line) || /Monthly\s+stats/i.test(line)) {
      currentSection = 'monthly';
      continue;
    } else if (/In-memory\s+yearly\s+stats/i.test(line) || /Yearly\s+stats/i.test(line)) {
      currentSection = 'yearly';
      continue;
    }

    if (!line.includes('totalTime') && !line.includes('TOTAL_TIME') && !line.includes('timeActive')) {
      continue;
    }

    const pkgMatch = line.match(/package[=:"'\s]+([a-zA-Z0-9_\.]+)/i) ||
                     line.match(/([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\s+(?:totalTime|time)/i);
    const timeMatch = line.match(/(?:TOTAL_TIME_IN_FOREGROUND|totalTimeInForeground|totalTimeUsed|totalTimeVisible|totalTimeActive|totalTime|timeActive)\s*[=:]\s*(?:"([^"]+)"|'([^']+)'|([0-9a-zA-Z:+]+))/i);

    if (pkgMatch && pkgMatch[1]) {
      const pkg = pkgMatch[1];
      if (!pkg.includes('.')) continue;

      let ms = 0;
      if (timeMatch) {
        const cleanTime = (timeMatch[1] || timeMatch[2] || timeMatch[3] || '').trim();
        ms = parseDurationToMs(cleanTime);
      }

      if (ms > 0) {
        const record = getOrCreate(pkg);
        if (currentSection === 'daily') {
          record.dailyMs = Math.max(record.dailyMs, ms);
        } else if (currentSection === 'weekly') {
          record.weeklyMs = Math.max(record.weeklyMs, ms);
        } else if (currentSection === 'monthly') {
          record.monthlyMs = Math.max(record.monthlyMs, ms);
        } else if (currentSection === 'yearly') {
          record.yearlyMs = Math.max(record.yearlyMs, ms);
        } else {
          // If no section headers were found (e.g. mock test), populate weeklyMs
          record.weeklyMs = Math.max(record.weeklyMs, ms);
        }
      }
    }
  }

  // Calculate final foregroundMs and weighted activity score
  for (const [pkg, record] of usageMap.entries()) {
    // Card display prioritizes weekly; fallbacks to monthly -> daily -> yearly
    if (record.weeklyMs > 0) {
      record.foregroundMs = record.weeklyMs;
    } else if (record.monthlyMs > 0) {
      record.foregroundMs = record.monthlyMs;
    } else if (record.dailyMs > 0) {
      record.foregroundMs = record.dailyMs;
    } else if (record.yearlyMs > 0) {
      record.foregroundMs = record.yearlyMs;
    } else {
      record.foregroundMs = 0;
    }

    // Weighted activity score: Weekly * 3 + Monthly * 1 + Daily * 2 + capped Yearly bonus
    record.weightedScore = (record.weeklyMs * 3) +
                           (record.monthlyMs * 1) +
                           (record.dailyMs * 2) +
                           Math.min(record.yearlyMs, 3600000 * 5) * 0.05;

    if (record.foregroundMs === 0 && record.weightedScore === 0) {
      usageMap.delete(pkg);
    }
  }

  return usageMap;
}

/**
 * Parse output of launcher intent queries:
 * `cmd package query-intent-activities -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`
 * 
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseLauncherActivities(text) {
  const launcherPkgs = new Set();
  if (!text) return launcherPkgs;

  const lines = text.split(/\r?\n/);
  // Match lines like:
  // activity: com.google.android.youtube/com.google.android.youtube.HomeActivity
  // packageName=com.google.android.youtube
  // 4a91b40 com.google.android.youtube/.app.honeycomb.Shell$HomeActivity filter 14d1019
  // com.google.android.youtube/.HomeActivity
  for (const line of lines) {
    const pkgMatch = line.match(/packageName=([a-zA-Z0-9_\.]+)/) ||
                     line.match(/(?:activity|component)[=:\s]+([a-zA-Z0-9_\.]+)\//) ||
                     line.match(/(?:^|\s+)([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\/[a-zA-Z0-9_\.\$]+/);
    if (pkgMatch && pkgMatch[1]) {
      const p = pkgMatch[1];
      if (p.includes('.') && !p.startsWith('android.intent') && !p.startsWith('http')) {
        launcherPkgs.add(p);
      }
    }
  }

  return launcherPkgs;
}

/**
 * Parse `dumpsys package` (single stream parsing for all packages)
 * Extracts per-package Dexopt status, reason, hasCode flag, splits, and secondary DEX files.
 * 
 * @param {string} text
 * @returns {Map<string, { status: string, reason: string, hasCode: boolean, isOverlay: boolean, splits: Array<object>, secondaryDex: Array<object>, hasSecondaryDex: boolean, hasOptimizableSecondaryDex: boolean, secondaryDexSummary: object|null }>}
 */
export function parseDumpsysPackageStream(text) {
  const dexoptMap = new Map();
  if (!text) return dexoptMap;

  const lines = text.split(/\r?\n/);
  let currentInfo = null;
  let inSecondaryDexSection = false;
  let currentSubItem = null; // { type: 'primary' | 'split' | 'secondary', path: string, ... }
  let inDexoptSection = false;

  const pkgStartRegex = /^(?:\s*Package\s*\[|\s*\[|\s*Package:\s*)(?<pkg>[a-zA-Z0-9_\.]+)[\]\:]/i;
  const patternBrackets = /\[status=(?<status>[a-zA-Z0-9_-]+)\](?:\s+\[reason=(?<reason>[a-zA-Z0-9_-]+)\])?/i;
  const patternFilter = /(?:compilation[-_\s]*filter|status)[=:\s]+(?<status>[a-zA-Z0-9_-]+)/i;
  const patternReason = /(?:compilation[-_\s]*reason|reason)[=:\s]+(?<reason>[a-zA-Z0-9_-]+)/i;

  const finalizePreviousInfo = () => {
    if (!currentInfo) return;

    // Detect empty package block in Dexopt state: (Issue #9 Problem 3)
    // If package appeared in Dexopt state and has 0 paths and 0 status/filter lines,
    // or matches known RRO/Overlay/Config/Shim naming pattern, mark as cannotAot
    if (isNoCodeOrOverlayPackage(currentInfo.packageName)) {
      currentInfo.hasCode = false;
      currentInfo.isOverlay = true;
      if (currentInfo.status === 'unknown') currentInfo.status = 'N/A';
      if (currentInfo.reason === 'unknown') currentInfo.reason = 'no-code';
    } else if (currentInfo.inDexoptSection && currentInfo.pathCount === 0 && !currentInfo.hasPrimaryStatus) {
      currentInfo.hasCode = false;
      currentInfo.isOverlay = true;
      currentInfo.status = 'N/A';
      currentInfo.reason = 'no-code';
    }

    // Summarize secondary DEX items if present
    if (currentInfo.secondaryDex && currentInfo.secondaryDex.length > 0) {
      currentInfo.hasSecondaryDex = true;
      const optimizable = currentInfo.secondaryDex.filter((s) => s.isOptimizable);
      currentInfo.hasOptimizableSecondaryDex = optimizable.length > 0;
      currentInfo.secondaryDexSummary = {
        total: currentInfo.secondaryDex.length,
        optimizableCount: optimizable.length,
        restrictedCount: currentInfo.secondaryDex.filter((s) => s.isUnsupportedContext || s.isRemoved).length,
        compiledCount: currentInfo.secondaryDex.filter((s) => s.status === 'speed' || s.status === 'speed-profile').length,
      };
    }
  };

  const getOrCreateInfo = (pkg) => {
    if (!dexoptMap.has(pkg)) {
      dexoptMap.set(pkg, {
        packageName: pkg,
        status: 'unknown',
        reason: 'unknown',
        hasCode: true,
        isOverlay: false,
        hasPrimaryStatus: false,
        pathCount: 0,
        inDexoptSection: false,
        splits: [],
        secondaryDex: [],
        hasSecondaryDex: false,
        hasOptimizableSecondaryDex: false,
        secondaryDexSummary: null,
      });
    }
    return dexoptMap.get(pkg);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^Dexopt state:/i.test(line.trim())) {
      inDexoptSection = true;
    }

    const pkgMatch = line.match(pkgStartRegex);
    if (pkgMatch && pkgMatch.groups && pkgMatch.groups.pkg) {
      const candidatePkg = pkgMatch.groups.pkg;
      // Filter out non-package identifiers (e.g. instruction sets or paths)
      if (candidatePkg.includes('.') && !candidatePkg.startsWith('http')) {
        finalizePreviousInfo();
        currentInfo = getOrCreateInfo(candidatePkg);
        if (inDexoptSection || /^\s*\[[a-zA-Z0-9_\.]+\]/i.test(line)) {
          currentInfo.inDexoptSection = true;
        }
        inSecondaryDexSection = false;
        currentSubItem = null;
        continue;
      }
    }

    if (!currentInfo) continue;

    if (line.includes('hasCode=false') || line.includes('apk does not have code') || line.includes('(none)')) {
      currentInfo.hasCode = false;
    }

    if (line.includes('overlay') && (line.includes('isOverlay=true') || line.includes('targetPackage='))) {
      currentInfo.isOverlay = true;
    }

    // Detect known secondary dex files: section
    if (/known secondary dex files:/i.test(line)) {
      inSecondaryDexSection = true;
      currentSubItem = null;
      continue;
    }

    // Detect primary or split APK path line
    const pathMatch = line.match(/^\s*path:\s*(.+)$/i);
    if (pathMatch) {
      const p = pathMatch[1].trim();
      currentInfo.pathCount++;
      const isSplit = p.includes('/split_') || p.includes('.split_');
      currentSubItem = {
        type: isSplit ? 'split' : 'primary',
        path: p,
        name: isSplit ? (p.split('/').pop() || p) : 'base.apk',
        status: 'unknown',
        reason: 'unknown',
      };
      if (isSplit) {
        currentInfo.splits.push(currentSubItem);
      }
      continue;
    }

    // Detect secondary dex file path inside known secondary dex files:
    if (inSecondaryDexSection) {
      const secPathMatch = line.match(/^\s*(\/[a-zA-Z0-9_\-\.\/]+(?:\.jar|\.dex|\.apk))(?:\s*\(removed\))?/i);
      if (secPathMatch) {
        const secPath = secPathMatch[1].trim();
        const isRemoved = line.includes('(removed)');
        currentSubItem = {
          type: 'secondary',
          path: secPath,
          status: 'unknown',
          reason: 'unknown',
          isRemoved,
          isUnsupportedContext: false,
          isOptimizable: false,
        };
        currentInfo.secondaryDex.push(currentSubItem);
        currentInfo.pathCount++;
        continue;
      }

      // Check class loader context & removed/error location
      if (/class loader context:/i.test(line)) {
        if (/UnsupportedClassLoaderContext/i.test(line) && currentSubItem && currentSubItem.type === 'secondary') {
          currentSubItem.isUnsupportedContext = true;
          currentSubItem.isOptimizable = false;
        }
      }
      if (/location is error/i.test(line) && currentSubItem && currentSubItem.type === 'secondary') {
        currentSubItem.isRemoved = true;
        currentSubItem.isOptimizable = false;
      }
    }

    // Extract status and reason from line
    let lineStatus = null;
    let lineReason = null;

    const bracketMatch = line.match(patternBrackets);
    if (bracketMatch && bracketMatch.groups) {
      lineStatus = bracketMatch.groups.status;
      lineReason = bracketMatch.groups.reason;
    } else {
      const filterMatch = line.match(patternFilter);
      if (filterMatch && filterMatch.groups && filterMatch.groups.status) {
        const s = filterMatch.groups.status;
        if (s !== 'kOatUpToDate') lineStatus = s;
      }
      const reasonMatch = line.match(patternReason);
      if (reasonMatch && reasonMatch.groups && reasonMatch.groups.reason) {
        lineReason = reasonMatch.groups.reason;
      }
    }

    if (lineStatus || lineReason) {
      if (inSecondaryDexSection) {
        if (currentSubItem && currentSubItem.type === 'secondary') {
          if (lineStatus) currentSubItem.status = lineStatus;
          if (lineReason) currentSubItem.reason = lineReason;
          currentSubItem.isOptimizable = !currentSubItem.isUnsupportedContext &&
                                         !currentSubItem.isRemoved &&
                                         currentSubItem.status !== 'speed' &&
                                         currentSubItem.status !== 'speed-profile';
        }
      } else if (currentSubItem && currentSubItem.type === 'split') {
        if (lineStatus) currentSubItem.status = lineStatus;
        if (lineReason) currentSubItem.reason = lineReason;
      } else {
        // Primary APK (base.apk)
        // First-Match for primary base.apk locks the main status & reason! (Issue #9 Problem 1)
        if (lineStatus && (!currentInfo.hasPrimaryStatus || currentInfo.status === 'unknown')) {
          currentInfo.status = lineStatus;
          currentInfo.hasPrimaryStatus = true;
        }
        if (lineReason && (!currentInfo.hasPrimaryReason || currentInfo.reason === 'unknown')) {
          currentInfo.reason = lineReason;
          currentInfo.hasPrimaryReason = true;
        }
      }
    }
  }

  finalizePreviousInfo();
  return dexoptMap;
}

/**
 * Parse a single package's dumpsys output (for partial re-query after compile)
 * @param {string} text
 * @returns {{ status: string, reason: string, hasCode: boolean, splits: Array<object>, secondaryDex: Array<object>, hasSecondaryDex: boolean, hasOptimizableSecondaryDex: boolean, secondaryDexSummary: object|null }}
 */
export function parseSinglePackageDexopt(text) {
  const result = {
    status: 'unknown',
    reason: 'unknown',
    hasCode: true,
    splits: [],
    secondaryDex: [],
    hasSecondaryDex: false,
    hasOptimizableSecondaryDex: false,
    secondaryDexSummary: null,
  };

  if (!text) return result;

  if (text.includes('hasCode=false') || text.includes('apk does not have code') || text.includes('(none)')) {
    result.hasCode = false;
  }

  // Use parseDumpsysPackageStream to ensure 100% parsing parity with batch scanning
  const streamMap = parseDumpsysPackageStream(text);
  if (streamMap.size > 0) {
    const firstInfo = streamMap.values().next().value;
    if (firstInfo) {
      result.status = firstInfo.status;
      result.reason = firstInfo.reason;
      result.hasCode = firstInfo.hasCode;
      result.splits = firstInfo.splits;
      result.secondaryDex = firstInfo.secondaryDex;
      result.hasSecondaryDex = firstInfo.hasSecondaryDex;
      result.hasOptimizableSecondaryDex = firstInfo.hasOptimizableSecondaryDex;
      result.secondaryDexSummary = firstInfo.secondaryDexSummary;
      return result;
    }
  }

  const bracketMatch = text.match(/\[status=(?<status>[a-zA-Z0-9_-]+)\](?:\s+\[reason=(?<reason>[a-zA-Z0-9_-]+)\])?/i);
  if (bracketMatch && bracketMatch.groups) {
    if (bracketMatch.groups.status) result.status = bracketMatch.groups.status;
    if (bracketMatch.groups.reason) result.reason = bracketMatch.groups.reason;
    return result;
  }

  const filterMatch = text.match(/(?:compilation[-_\s]*filter|status)[=:\s]+(?<status>[a-zA-Z0-9_-]+)/i);
  if (filterMatch && filterMatch.groups && filterMatch.groups.status) {
    result.status = filterMatch.groups.status;
  }

  const reasonMatch = text.match(/(?:compilation[-_\s]*reason|reason)[=:\s]+(?<reason>[a-zA-Z0-9_-]+)/i);
  if (reasonMatch && reasonMatch.groups && reasonMatch.groups.reason) {
    result.reason = reasonMatch.groups.reason;
  }

  return result;
}

/**
 * Categorize apps into three tiers:
 * - Frequently Used (Top)
 * - General (Middle)
 * - Cannot AOT (Bottom)
 * 
 * @param {Array<{ packageName: string, path: string, isSystem: boolean }>} packageList
 * @param {Map<string, object>|Set<string>} usageData
 * @param {Set<string>} launcherSet
 * @param {Map<string, { status: string, reason: string, hasCode: boolean, isOverlay: boolean }>} dexoptMap
 * @returns {{ frequentlyUsed: Array<object>, general: Array<object>, cannotAot: Array<object> }}
 */
export function classifyApps(packageList, usageData, launcherSet, dexoptMap, { maxFrequentlyUsed = 25, minForegroundMs = 0 } = {}) {
  const cannotAot = [];
  const candidates = [];

  const getUsageMs = (pkg) => {
    if (!usageData) return 0;
    if (usageData instanceof Map) {
      return usageData.get(pkg)?.foregroundMs || 0;
    }
    if (usageData instanceof Set) {
      return usageData.has(pkg) ? 300000 : 0;
    }
    return 0;
  };

  const getWeightedScore = (pkg) => {
    if (usageData instanceof Map) {
      return usageData.get(pkg)?.weightedScore || usageData.get(pkg)?.foregroundMs || 0;
    }
    return getUsageMs(pkg);
  };

  for (const pkgItem of packageList) {
    const pkg = pkgItem.packageName;
    const dexopt = dexoptMap.get(pkg) || {
      status: 'unknown',
      reason: 'unknown',
      hasCode: true,
      isOverlay: false,
      splits: [],
      secondaryDex: [],
      hasSecondaryDex: false,
      hasOptimizableSecondaryDex: false,
      secondaryDexSummary: null,
    };

    const isCannotAot = (
      dexopt.hasCode === false ||
      dexopt.isOverlay === true ||
      dexopt.status === 'verify-none' ||
      dexopt.status === 'error' ||
      dexopt.reason === 'no-code' ||
      isNoCodeOrOverlayPackage(pkg)
    );

    const foregroundMs = getUsageMs(pkg);
    const isLauncherApp = launcherSet.has(pkg);

    // 初始狀態下不預先判定 Profile，所有 App 均為未檢查狀態 (undefined)，
    // 按鈕一律遵循頂部 Dexopt modes，直到使用者主動點擊檢查 Profile 為止
    const initialHasProfile = undefined;
    const initialOverrideMode = undefined;

    const appRecord = {
      packageName: pkg,
      displayName: formatDisplayName(pkg),
      path: pkgItem.path,
      isSystem: pkgItem.isSystem,
      status: isCannotAot && dexopt.status === 'unknown' ? 'N/A' : dexopt.status,
      reason: isCannotAot && dexopt.reason === 'unknown' ? 'no-code' : dexopt.reason,
      hasCode: dexopt.hasCode,
      hasProfile: initialHasProfile,
      profileLines: 0,
      overrideMode: initialOverrideMode,
      isCannotAot,
      isOptimizing: false,
      foregroundMs,
      usageTimeFormatted: formatUsageDuration(foregroundMs),
      isLauncherApp,
      splits: dexopt.splits || [],
      secondaryDex: dexopt.secondaryDex || [],
      hasSecondaryDex: dexopt.hasSecondaryDex || false,
      hasOptimizableSecondaryDex: dexopt.hasOptimizableSecondaryDex || false,
      secondaryDexSummary: dexopt.secondaryDexSummary || null,
    };

    if (isCannotAot) {
      appRecord.tier = 'cannot_aot';
      cannotAot.push(appRecord);
    } else {
      candidates.push(appRecord);
    }
  }

  // Calculate usage score to find truly frequently used apps:
  // 1. Weighted recent activity score (Weekly*3 + Monthly*1 + Daily*2) is the primary factor.
  // 2. User launcher apps get priority over background services.
  // 3. User-installed apps get priority over system apps.
  const scored = candidates.map((app) => {
    let score = getWeightedScore(app.packageName);
    if (app.isLauncherApp && !app.isSystem) {
      score += 180000; // 3 min boost for user launcher apps
    } else if (!app.isSystem) {
      score += 60000;  // 1 min boost for user-installed apps
    }
    return { app, score };
  });

  // Sort candidates by score descending:
  // 1. Higher score first
  // 2. Higher foregroundMs first
  // 3. User apps before system apps
  // 4. Alphabetical display name
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.app.foregroundMs || 0) !== (a.app.foregroundMs || 0)) {
      return (b.app.foregroundMs || 0) - (a.app.foregroundMs || 0);
    }
    if (a.app.isSystem !== b.app.isSystem) {
      return a.app.isSystem ? 1 : -1;
    }
    return a.app.displayName.localeCompare(b.app.displayName);
  });

  const frequentlyUsed = [];
  const general = [];

  for (const item of scored) {
    const app = item.app;
    // Issue #9 Problem 4: System apps without a launcher activity (e.g. systemui, hubui)
    // are strictly excluded from Frequently Used!
    const isSystemBackgroundService = app.isSystem && !app.isLauncherApp;

    if (
      !isSystemBackgroundService &&
      frequentlyUsed.length < maxFrequentlyUsed &&
      item.score >= minForegroundMs &&
      item.score > 0
    ) {
      app.tier = 'frequently_used';
      frequentlyUsed.push(app);
    } else {
      app.tier = 'general';
      general.push(app);
    }
  }

  // Fallback: If frequentlyUsed is still 0 (e.g. minForegroundMs was set too high or zero usage recorded)
  // Ensure the top candidates (preferring user-installed / launcher apps) are placed in Frequently Used!
  if (frequentlyUsed.length === 0 && general.length > 0) {
    const targetFallbackCount = Math.min(15, maxFrequentlyUsed, general.length);
    // First try user apps
    for (let i = 0; i < general.length && frequentlyUsed.length < targetFallbackCount; i++) {
      if (!general[i].isSystem) {
        const promoted = general.splice(i, 1)[0];
        promoted.tier = 'frequently_used';
        frequentlyUsed.push(promoted);
        i--;
      }
    }
    // If still empty (all system apps), take top general launcher apps (excluding pure background services)
    for (let i = 0; i < general.length && frequentlyUsed.length < targetFallbackCount; i++) {
      if (general[i].isLauncherApp) {
        const promoted = general.splice(i, 1)[0];
        promoted.tier = 'frequently_used';
        frequentlyUsed.push(promoted);
        i--;
      }
    }
    // Final emergency fallback if no launcher apps at all
    while (frequentlyUsed.length < targetFallbackCount && general.length > 0) {
      const promoted = general.shift();
      promoted.tier = 'frequently_used';
      frequentlyUsed.push(promoted);
    }
  }

  // Frequently used sorted by actual usage time descending (most used first!), then name
  frequentlyUsed.sort((a, b) => (b.foregroundMs - a.foregroundMs) || a.displayName.localeCompare(b.displayName));

  // General apps sorted alphabetically
  const sorter = (a, b) => a.displayName.localeCompare(b.displayName);
  general.sort(sorter);
  cannotAot.sort(sorter);

  return {
    frequentlyUsed,
    general,
    cannotAot,
  };
}

/**
 * Derive human-friendly display name from package name
 * @param {string} pkg
 * @returns {string}
 */
export function formatDisplayName(pkg) {
  const KNOWN_NAMES = {
    'com.android.chrome': 'Google Chrome',
    'jp.naver.line.android': 'LINE',
    'com.google.android.youtube': 'YouTube',
    'com.google.android.gm': 'Gmail',
    'com.google.android.apps.maps': 'Google Maps',
    'com.google.android.apps.photos': 'Google Photos',
    'com.google.android.calculator': 'Calculator',
    'com.google.android.calendar': 'Google Calendar',
    'com.android.settings': 'Settings',
    'com.android.vending': 'Google Play Store',
    'com.google.android.googlequicksearchbox': 'Google App',
    'com.facebook.katana': 'Facebook',
    'com.instagram.android': 'Instagram',
    'com.zhiliaoapp.musically': 'TikTok',
    'org.telegram.messenger': 'Telegram',
    'com.spotify.music': 'Spotify',
    'com.netflix.mediaclient': 'Netflix',
    'com.twitter.android': 'X (Twitter)',
    'com.android.chrome.beta': 'Chrome Beta',
    'com.google.android.apps.messaging': 'Google Messages',
    'com.google.android.apps.docs': 'Google Drive',
    'com.google.android.play.games': 'Google Play Games',
    'com.google.android.keep': 'Google Keep',
    'com.google.android.contacts': 'Contacts',
    'com.google.android.dialer': 'Phone',
    'com.google.android.deskclock': 'Clock',
    'com.google.android.apps.nexuslauncher': 'Pixel Launcher',
    'com.google.android.apps.wallpaper': 'Wallpapers',
    'com.google.android.gms': 'Google Play Services',
    'com.google.android.gsf': 'Google Services Framework',
    'com.android.systemui': 'System UI',
    'com.tencent.mm': 'WeChat',
    'com.facebook.orca': 'Messenger',
    'com.gpconsumermobile.plus': '環保集點 (GreenPoint)',
  };

  if (!pkg) return '';
  const lowerPkg = String(pkg).toLowerCase();
  for (const [knownPkg, knownName] of Object.entries(KNOWN_NAMES)) {
    if (knownPkg.toLowerCase() === lowerPkg) {
      return knownName;
    }
  }

  // Split by dot and take the last or second to last segment
  const parts = pkg.split('.').filter(Boolean);
  let name = parts[parts.length - 1] || pkg;

  // If last part is too generic like 'android', use previous part
  if (['android', 'app', 'client', 'mobile'].includes(name.toLowerCase()) && parts.length > 1) {
    name = parts[parts.length - 2];
  }

  // Capitalize words separated by underscores or camelCase
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return name.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Priority score for Dexopt status depending on sort direction
 * @param {string} status
 * @param {'unknown_first' | 'speed_first'} direction
 * @returns {number}
 */
export function getStatusPriority(status, direction = 'unknown_first') {
  const norm = String(status || '').toLowerCase().trim();

  if (direction === 'unknown_first') {
    // unknown comes first, then error, verify, speed-profile, speed, N/A
    switch (norm) {
      case 'unknown':
        return 100;
      case 'error':
        return 90;
      case 'verify':
      case 'quicken':
      case 'run-from-apk':
        return 80;
      case 'speed-profile':
        return 60;
      case 'speed':
      case 'everything':
        return 40;
      case 'n/a':
      case 'no-code':
        return 20;
      default:
        return 10;
    }
  } else {
    // speed comes first, then speed-profile, verify, error, unknown, N/A
    switch (norm) {
      case 'speed':
      case 'everything':
        return 100;
      case 'speed-profile':
        return 80;
      case 'verify':
      case 'quicken':
      case 'run-from-apk':
        return 60;
      case 'error':
        return 40;
      case 'unknown':
        return 30;
      case 'n/a':
      case 'no-code':
        return 20;
      default:
        return 10;
    }
  }
}

/**
 * Sort an array of app objects based on sortMode
 * @param {Array<object>} apps
 * @param {string} sortMode - 'default' | 'status_unknown_first' | 'status_speed_first' | 'name_asc' | 'usage_desc'
 * @returns {Array<object>} new sorted array
 */
export function sortApps(apps, sortMode = 'default') {
  if (!Array.isArray(apps)) return [];
  const list = [...apps];

  switch (sortMode) {
    case 'status_unknown_first':
      return list.sort((a, b) => {
        const diff = getStatusPriority(b.status, 'unknown_first') - getStatusPriority(a.status, 'unknown_first');
        if (diff !== 0) return diff;
        return a.displayName.localeCompare(b.displayName);
      });

    case 'status_speed_first':
      return list.sort((a, b) => {
        const diff = getStatusPriority(b.status, 'speed_first') - getStatusPriority(a.status, 'speed_first');
        if (diff !== 0) return diff;
        return a.displayName.localeCompare(b.displayName);
      });

    case 'name_asc':
      return list.sort((a, b) => a.displayName.localeCompare(b.displayName));

    case 'usage_desc':
      return list.sort((a, b) => (b.foregroundMs || 0) - (a.foregroundMs || 0) || a.displayName.localeCompare(b.displayName));

    case 'profile_ready_first':
      return list.sort((a, b) => {
        // 具備熱點優先 (3: 有 Profile, 2: 未檢查, 1: 無 Profile)
        const getProfilePriority = (app) => {
          if (app.hasProfile === true) return 3;
          if (app.hasProfile === undefined) return 2;
          return 1;
        };
        const pA = getProfilePriority(a);
        const pB = getProfilePriority(b);
        if (pA !== pB) return pB - pA;

        // 若皆具備 Profile，熱點行數多者優先
        if (a.hasProfile === true && b.hasProfile === true) {
          const linesA = typeof a.profileLines === 'number' ? a.profileLines : 0;
          const linesB = typeof b.profileLines === 'number' ? b.profileLines : 0;
          if (linesA !== linesB) return linesB - linesA;
        }

        // 次要條件：使用時間降冪，最後依名稱排序
        if ((b.foregroundMs || 0) !== (a.foregroundMs || 0)) {
          return (b.foregroundMs || 0) - (a.foregroundMs || 0);
        }
        return a.displayName.localeCompare(b.displayName);
      });

    case 'profile_none_first':
      return list.sort((a, b) => {
        // 無熱點優先 (3: 確認無 Profile, 2: 未檢查, 1: 有 Profile)
        const getNonePriority = (app) => {
          if (app.hasProfile === false) return 3;
          if (app.hasProfile === undefined) return 2;
          return 1;
        };
        const pA = getNonePriority(a);
        const pB = getNonePriority(b);
        if (pA !== pB) return pB - pA;

        // 次要條件：優先排列尚未完整 AOT 之狀態 (verify/unknown 優先)
        if (a.status !== b.status) {
          const diff = getStatusPriority(b.status, 'unknown_first') - getStatusPriority(a.status, 'unknown_first');
          if (diff !== 0) return diff;
        }
        return a.displayName.localeCompare(b.displayName);
      });

    case 'default':
    default:
      return list;
  }
}

