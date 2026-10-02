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
 * Parse output of `dumpsys usagestats`
 * Extracts packages that have recorded foreground time > 0 or recent interactions
 * 
 * @param {string} text
 * @returns {Set<string>} Set of frequently used package names
 */
export function parseUsageStats(text) {
  const usedPackages = new Set();
  if (!text) return usedPackages;

  const lines = text.split(/\r?\n/);

  // Match variants like:
  // package=com.google.android.youtube totalTimeInForeground="12345"
  // package="com.android.chrome" time="123" TOTAL_TIME_IN_FOREGROUND="4567"
  // Package com.android.chrome: ...
  for (const line of lines) {
    if (!line.includes('TOTAL_TIME_IN_FOREGROUND') && !line.includes('totalTimeInForeground') && !line.includes('totalTime')) {
      continue;
    }

    const pkgMatch = line.match(/package[=:"'\s]+([a-zA-Z0-9_\.]+)/i) || line.match(/([a-zA-Z0-9_\.]+)\s+totalTime/i);
    const timeMatch = line.match(/(?:TOTAL_TIME_IN_FOREGROUND|totalTimeInForeground|totalTime)[=:"'\s]+([0-9\:]+)/i);

    if (pkgMatch && pkgMatch[1]) {
      const pkg = pkgMatch[1];
      if (timeMatch && timeMatch[1]) {
        const rawTime = timeMatch[1].replace(/:/g, '');
        const timeVal = parseInt(rawTime, 10);
        if (timeVal > 0) {
          usedPackages.add(pkg);
        }
      } else {
        usedPackages.add(pkg);
      }
    }
  }

  return usedPackages;
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
  for (const line of lines) {
    const pkgMatch = line.match(/packageName=([a-zA-Z0-9_\.]+)/) ||
                     line.match(/(?:activity|component)[=:\s]+([a-zA-Z0-9_\.]+)\//);
    if (pkgMatch && pkgMatch[1]) {
      launcherPkgs.add(pkgMatch[1]);
    }
  }

  return launcherPkgs;
}

/**
 * Parse `dumpsys package` (single stream parsing for all packages)
 * Extracts per-package Dexopt status, reason, and hasCode flag.
 * 
 * @param {string} text
 * @returns {Map<string, { status: string, reason: string, hasCode: boolean, isOverlay: boolean }>}
 */
export function parseDumpsysPackageStream(text) {
  const dexoptMap = new Map();
  if (!text) return dexoptMap;

  const lines = text.split(/\r?\n/);
  let currentInfo = null;

  // Matches either:
  // "Package [com.foo] (...)" (from Package Details in dumpsys package)
  // "  [com.foo]" (from dumpsys package dexopt or Dexopt state: section)
  // "Package: com.foo"
  const pkgStartRegex = /^(?:\s*Package\s*\[|\s*\[|\s*Package:\s*)(?<pkg>[a-zA-Z0-9_\.]+)[\]\:]/i;

  // Pattern 1: [status=speed-profile] [reason=bg-dexopt] or [status=speed]
  const patternBrackets = /\[status=(?<status>[a-zA-Z0-9_-]+)\](?:\s+\[reason=(?<reason>[a-zA-Z0-9_-]+)\])?/i;
  // Pattern 2: compilation filter: speed-profile or compilation_filter=speed-profile
  const patternFilter = /(?:compilation[-_\s]*filter|status)[=:\s]+(?<status>[a-zA-Z0-9_-]+)/i;
  // Pattern 3: compilation reason: bg-dexopt or reason=bg-dexopt
  const patternReason = /(?:compilation[-_\s]*reason|reason)[=:\s]+(?<reason>[a-zA-Z0-9_-]+)/i;

  const getOrCreateInfo = (pkg) => {
    if (!dexoptMap.has(pkg)) {
      dexoptMap.set(pkg, {
        packageName: pkg,
        status: 'unknown',
        reason: 'unknown',
        hasCode: true,
        isOverlay: false,
      });
    }
    return dexoptMap.get(pkg);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const pkgMatch = line.match(pkgStartRegex);
    if (pkgMatch && pkgMatch.groups && pkgMatch.groups.pkg) {
      const candidatePkg = pkgMatch.groups.pkg;
      // Filter out non-package identifiers (e.g. instruction sets or paths)
      if (candidatePkg.includes('.') && !candidatePkg.startsWith('http')) {
        currentInfo = getOrCreateInfo(candidatePkg);
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

    // Try brackets first: [status=speed-profile] [reason=bg-dexopt]
    const bracketMatch = line.match(patternBrackets);
    if (bracketMatch && bracketMatch.groups) {
      if (bracketMatch.groups.status) currentInfo.status = bracketMatch.groups.status;
      if (bracketMatch.groups.reason) currentInfo.reason = bracketMatch.groups.reason;
      continue;
    }

    // Try filter/status
    const filterMatch = line.match(patternFilter);
    if (filterMatch && filterMatch.groups && filterMatch.groups.status) {
      const s = filterMatch.groups.status;
      if (s !== 'kOatUpToDate') {
        currentInfo.status = s;
      }
    }

    // Try reason
    const reasonMatch = line.match(patternReason);
    if (reasonMatch && reasonMatch.groups && reasonMatch.groups.reason) {
      currentInfo.reason = reasonMatch.groups.reason;
    }
  }

  return dexoptMap;
}

/**
 * Parse a single package's dumpsys output (for partial re-query after compile)
 * @param {string} text
 * @returns {{ status: string, reason: string, hasCode: boolean }}
 */
export function parseSinglePackageDexopt(text) {
  const result = {
    status: 'unknown',
    reason: 'unknown',
    hasCode: true,
  };

  if (!text) return result;

  if (text.includes('hasCode=false') || text.includes('apk does not have code') || text.includes('(none)')) {
    result.hasCode = false;
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
 * @param {Set<string>} usageSet
 * @param {Set<string>} launcherSet
 * @param {Map<string, { status: string, reason: string, hasCode: boolean, isOverlay: boolean }>} dexoptMap
 * @returns {{ frequentlyUsed: Array<object>, general: Array<object>, cannotAot: Array<object> }}
 */
export function classifyApps(packageList, usageSet, launcherSet, dexoptMap) {
  const frequentlyUsed = [];
  const general = [];
  const cannotAot = [];

  for (const pkgItem of packageList) {
    const pkg = pkgItem.packageName;
    const dexopt = dexoptMap.get(pkg) || {
      status: 'unknown',
      reason: 'unknown',
      hasCode: true,
      isOverlay: false,
    };

    const isUsageFrequent = usageSet.has(pkg);
    const isLauncherApp = launcherSet.has(pkg);
    const isThirdParty = !pkgItem.isSystem;

    // Check Cannot AOT criteria:
    // 1. hasCode is false
    // 2. Overlay package
    // 3. Status is verify-none, error, or no dex
    const isCannotAot = (
      dexopt.hasCode === false ||
      dexopt.isOverlay === true ||
      dexopt.status === 'verify-none' ||
      dexopt.status === 'error' ||
      dexopt.reason === 'no-code' ||
      pkg.endsWith('.overlay')
    );

    const appRecord = {
      packageName: pkg,
      displayName: formatDisplayName(pkg),
      path: pkgItem.path,
      isSystem: pkgItem.isSystem,
      status: isCannotAot && dexopt.status === 'unknown' ? 'N/A' : dexopt.status,
      reason: isCannotAot && dexopt.reason === 'unknown' ? 'no-code' : dexopt.reason,
      hasCode: dexopt.hasCode,
      isCannotAot,
      isOptimizing: false,
    };

    if (isCannotAot) {
      appRecord.tier = 'cannot_aot';
      cannotAot.push(appRecord);
    } else if (isUsageFrequent || (isLauncherApp && isThirdParty)) {
      appRecord.tier = 'frequently_used';
      frequentlyUsed.push(appRecord);
    } else {
      appRecord.tier = 'general';
      general.push(appRecord);
    }
  }

  // Sort each group alphabetically by display name
  const sorter = (a, b) => a.displayName.localeCompare(b.displayName);
  frequentlyUsed.sort(sorter);
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
  };

  if (KNOWN_NAMES[pkg]) {
    return KNOWN_NAMES[pkg];
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
