import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePackageList,
  parseDurationToMs,
  formatUsageDuration,
  parseUsageStats,
  parseLauncherActivities,
  parseDumpsysPackageStream,
  parseSinglePackageDexopt,
  classifyApps,
  formatDisplayName,
  getStatusPriority,
  sortApps,
  calculateUsagePriorityScore,
} from '../src/parser.js';

test('parsePackageList correctly parses third party and system packages', () => {
  const sample = `
package:/data/app/~~xyz/com.android.chrome-abc==/base.apk=com.android.chrome
package:/system/priv-app/Settings/Settings.apk=com.android.settings
package:/product/overlay/PixelTheme.apk=com.google.android.theme.pixel.overlay
`;
  const result = parsePackageList(sample);
  assert.equal(result.size, 3);
  assert.equal(result.get('com.android.chrome').isSystem, false);
  assert.equal(result.get('com.android.settings').isSystem, true);
  assert.equal(result.get('com.google.android.theme.pixel.overlay').isSystem, true);
});

test('parseUsageStats extracts packages with foreground time', () => {
  const sample = `
  package="com.android.chrome" totalTimeInForeground="01:23:45"
  package=jp.naver.line.android totalTimeInForeground="54321"
  package=com.unused.app totalTimeInForeground="00:00:00"
`;
  const used = parseUsageStats(sample);
  assert.ok(used.has('com.android.chrome'));
  assert.ok(used.has('jp.naver.line.android'));
  assert.ok(!used.has('com.unused.app'));
});

test('parseLauncherActivities extracts launcher package names', () => {
  const sample = `
  activity: com.google.android.youtube/com.google.android.youtube.HomeActivity
  packageName=com.android.chrome
`;
  const launchers = parseLauncherActivities(sample);
  assert.ok(launchers.has('com.google.android.youtube'));
  assert.ok(launchers.has('com.android.chrome'));
});

test('parseDumpsysPackageStream parses dexopt states, reason, and hasCode', () => {
  const sample = `
Package [com.android.chrome] (12345):
  userId=10123
  hasCode=true
  Dexopt state:
    [com.android.chrome]
      path: /data/app/base.apk
        arm64: [status=speed-profile] [reason=bg-dexopt]
Package [jp.naver.line.android] (23456):
  userId=10124
  hasCode=true
  Dexopt state:
    [jp.naver.line.android]
      path: /data/app/base.apk
        arm64: [status=speed] [reason=cmdline]
Package [com.google.android.calculator] (34567):
  userId=10125
  hasCode=true
  Dexopt state:
    [com.google.android.calculator]
      path: /data/app/base.apk
        arm64: [status=verify] [reason=vdex]
Package [com.google.pixel.overlay] (45678):
  userId=10126
  hasCode=false
  Dexopt state:
    (none)
`;
  const map = parseDumpsysPackageStream(sample);
  assert.equal(map.get('com.android.chrome').status, 'speed-profile');
  assert.equal(map.get('com.android.chrome').reason, 'bg-dexopt');
  assert.equal(map.get('jp.naver.line.android').status, 'speed');
  assert.equal(map.get('com.google.android.calculator').status, 'verify');
  assert.equal(map.get('com.google.pixel.overlay').hasCode, false);
});

test('parseSinglePackageDexopt extracts status and reason', () => {
  const sample = `
  Dexopt state:
    [com.android.chrome]
      path: /data/app/base.apk
        arm64: [status=speed] [reason=cmdline]
`;
  const res = parseSinglePackageDexopt(sample);
  assert.equal(res.status, 'speed');
  assert.equal(res.reason, 'cmdline');
});

test('classifyApps categorizes apps into Frequently Used, General, and Cannot AOT', () => {
  const pkgList = [
    { packageName: 'com.android.chrome', path: '/data/app/chrome.apk', isSystem: false },
    { packageName: 'com.google.android.calculator', path: '/system/app/calc.apk', isSystem: true },
    { packageName: 'com.google.pixel.overlay', path: '/system/overlay.apk', isSystem: true },
  ];
  const usageSet = new Set(['com.android.chrome']);
  const launcherSet = new Set(['com.android.chrome', 'com.google.android.calculator']);
  const dexoptMap = new Map([
    ['com.android.chrome', { status: 'speed-profile', reason: 'bg-dexopt', hasCode: true, isOverlay: false }],
    ['com.google.android.calculator', { status: 'verify', reason: 'vdex', hasCode: true, isOverlay: false }],
    ['com.google.pixel.overlay', { status: 'unknown', reason: 'unknown', hasCode: false, isOverlay: true }],
  ]);

  const { frequentlyUsed, general, cannotAot } = classifyApps(pkgList, usageSet, launcherSet, dexoptMap);
  assert.equal(frequentlyUsed.length, 1);
  assert.equal(frequentlyUsed[0].packageName, 'com.android.chrome');

  assert.equal(general.length, 1);
  assert.equal(general[0].packageName, 'com.google.android.calculator');

  assert.equal(cannotAot.length, 1);
  assert.equal(cannotAot[0].packageName, 'com.google.pixel.overlay');
  assert.equal(cannotAot[0].status, 'N/A');
  assert.equal(cannotAot[0].reason, 'no-code');
});

test('formatDisplayName produces readable names', () => {
  assert.equal(formatDisplayName('com.android.chrome'), 'Google Chrome');
  assert.equal(formatDisplayName('jp.naver.line.android'), 'LINE');
  assert.equal(formatDisplayName('com.foo.bar_baz'), 'Bar Baz');
  // Issue #8 example: com.gpconsumermobile.plus -> 環保集點 (GreenPoint)
  assert.equal(formatDisplayName('com.gpconsumermobile.plus'), '環保集點 (GreenPoint)');
  assert.equal(formatDisplayName('com.GpConsumerMobile.Plus'), '環保集點 (GreenPoint)');
});

test('parseDumpsysPackageStream handles pure dumpsys package dexopt output', () => {
  const sample = `
Dexopt state:
  [com.android.chrome]
    path: /data/app/~~xyz/base.apk
      arm64: [status=speed-profile] [reason=bg-dexopt]
  [jp.naver.line.android]
    path: /data/app/~~abc/base.apk
      arm64: [status=speed] [reason=cmdline]
  [com.google.android.overlay]
    (none)
`;
  const map = parseDumpsysPackageStream(sample);
  assert.equal(map.get('com.android.chrome').status, 'speed-profile');
  assert.equal(map.get('com.android.chrome').reason, 'bg-dexopt');
  assert.equal(map.get('jp.naver.line.android').status, 'speed');
  assert.equal(map.get('com.google.android.overlay').hasCode, false);
});

test('parseDumpsysPackageStream handles Android 14+ ART Service compilation filter format', () => {
  const sample = `
[com.android.chrome]
  path: /data/app/base.apk
    compilation filter: speed-profile
    compilation reason: bg-dexopt
[com.google.android.calculator]
  path: /system/app/calc.apk
    compilation_filter=verify
    compilation_reason=vdex
`;
  const map = parseDumpsysPackageStream(sample);
  assert.equal(map.get('com.android.chrome').status, 'speed-profile');
  assert.equal(map.get('com.android.chrome').reason, 'bg-dexopt');
  assert.equal(map.get('com.google.android.calculator').status, 'verify');
  assert.equal(map.get('com.google.android.calculator').reason, 'vdex');
});

test('parseDurationToMs and formatUsageDuration handle varied time formats', () => {
  assert.equal(parseDurationToMs('120000'), 120000);
  assert.equal(parseDurationToMs('01:30:00'), 5400000);
  assert.equal(parseDurationToMs('15:30'), 930000);
  assert.equal(parseDurationToMs('1h20m'), 4800000);
  assert.equal(parseDurationToMs('45m'), 2700000);

  assert.equal(formatUsageDuration(5400000), '1h 30m');
  assert.equal(formatUsageDuration(3600000), '1h');
  assert.equal(formatUsageDuration(900000), '15m');
  assert.equal(formatUsageDuration(30000), ''); // Under 1 minute returns empty
});

test('classifyApps ranks top frequently used apps by usage time and respects limit', () => {
  const pkgList = [
    { packageName: 'app.heavy', path: '/data/app/heavy.apk', isSystem: false },
    { packageName: 'app.medium', path: '/data/app/medium.apk', isSystem: false },
    { packageName: 'app.light', path: '/data/app/light.apk', isSystem: false },
    { packageName: 'app.negligible', path: '/data/app/negligible.apk', isSystem: false },
  ];

  const usageMap = new Map([
    ['app.heavy', { foregroundMs: 3600000 }], // 1 hour
    ['app.medium', { foregroundMs: 1800000 }], // 30 mins
    ['app.light', { foregroundMs: 300000 }], // 5 mins
    ['app.negligible', { foregroundMs: 10000 }], // 10s (below min threshold)
  ]);

  const launcherSet = new Set(['app.heavy', 'app.medium', 'app.light', 'app.negligible']);
  const dexoptMap = new Map();

  // Limit frequently used to 2
  const { frequentlyUsed, general } = classifyApps(pkgList, usageMap, launcherSet, dexoptMap, {
    maxFrequentlyUsed: 2,
    minForegroundMs: 120000,
  });

  // Only top 2 qualify for frequentlyUsed
  assert.equal(frequentlyUsed.length, 2);
  assert.equal(frequentlyUsed[0].packageName, 'app.heavy');
  assert.equal(frequentlyUsed[0].usageTimeFormatted, '1h');
  assert.equal(frequentlyUsed[1].packageName, 'app.medium');
  assert.equal(frequentlyUsed[1].usageTimeFormatted, '30m');

  // app.light and app.negligible should be in general
  assert.equal(general.length, 2);
  const generalPkgs = general.map((a) => a.packageName);
  assert.ok(generalPkgs.includes('app.light'));
  assert.ok(generalPkgs.includes('app.negligible'));
});

test('getStatusPriority ranks unknown highest for unknown_first and speed highest for speed_first', () => {
  assert.ok(getStatusPriority('unknown', 'unknown_first') > getStatusPriority('verify', 'unknown_first'));
  assert.ok(getStatusPriority('verify', 'unknown_first') > getStatusPriority('speed-profile', 'unknown_first'));
  assert.ok(getStatusPriority('speed-profile', 'unknown_first') > getStatusPriority('speed', 'unknown_first'));

  assert.ok(getStatusPriority('speed', 'speed_first') > getStatusPriority('speed-profile', 'speed_first'));
  assert.ok(getStatusPriority('speed-profile', 'speed_first') > getStatusPriority('verify', 'speed_first'));
  assert.ok(getStatusPriority('verify', 'speed_first') > getStatusPriority('unknown', 'speed_first'));
});

test('sortApps correctly sorts apps by status_unknown_first', () => {
  const apps = [
    { packageName: 'com.a', displayName: 'Alpha', status: 'speed' },
    { packageName: 'com.b', displayName: 'Beta', status: 'unknown' },
    { packageName: 'com.c', displayName: 'Gamma', status: 'verify' },
    { packageName: 'com.d', displayName: 'Delta', status: 'speed-profile' },
  ];

  const sorted = sortApps(apps, 'status_unknown_first');
  assert.equal(sorted[0].packageName, 'com.b'); // unknown
  assert.equal(sorted[1].packageName, 'com.c'); // verify
  assert.equal(sorted[2].packageName, 'com.d'); // speed-profile
  assert.equal(sorted[3].packageName, 'com.a'); // speed
});

test('sortApps correctly sorts apps by status_speed_first, name_asc, and usage_desc', () => {
  const apps = [
    { packageName: 'com.a', displayName: 'Charlie', status: 'unknown', foregroundMs: 1000 },
    { packageName: 'com.b', displayName: 'Bravo', status: 'speed', foregroundMs: 5000 },
    { packageName: 'com.c', displayName: 'Alpha', status: 'verify', foregroundMs: 3000 },
  ];

  const speedFirst = sortApps(apps, 'status_speed_first');
  assert.equal(speedFirst[0].packageName, 'com.b'); // speed

  const nameAsc = sortApps(apps, 'name_asc');
  assert.equal(nameAsc[0].displayName, 'Alpha');
  assert.equal(nameAsc[1].displayName, 'Bravo');
  assert.equal(nameAsc[2].displayName, 'Charlie');

  const usageDesc = sortApps(apps, 'usage_desc');
  assert.equal(usageDesc[0].packageName, 'com.b'); // 5000ms
  assert.equal(usageDesc[1].packageName, 'com.c'); // 3000ms
  assert.equal(usageDesc[2].packageName, 'com.a'); // 1000ms
});

test('classifyApps ensures Frequently Used is never empty when valid candidates exist', () => {
  const pkgList = [
    { packageName: 'com.android.chrome', path: '/data/app/chrome/base.apk', isSystem: false },
    { packageName: 'jp.naver.line.android', path: '/data/app/line/base.apk', isSystem: false },
    { packageName: 'com.google.android.youtube', path: '/data/app/youtube/base.apk', isSystem: false },
    { packageName: 'com.android.settings', path: '/system/priv-app/Settings/base.apk', isSystem: true },
  ];

  // Completely empty usage map (e.g. freshly rebooted device)
  const emptyUsage = new Map();
  const launcherOutput = `
Activity Resolver Table:
  Non-Data Actions:
      android.intent.action.MAIN:
        4a91b40 com.google.android.youtube/.Shell filter 14d1019
        3b81c20 com.android.chrome/com.google.android.apps.chrome.Main filter 87b2123
        2c91a10 jp.naver.line.android/.MainActivity filter 99a1212
  `;
  const launcherSet = parseLauncherActivities(launcherOutput);
  const dexoptMap = new Map();

  const { frequentlyUsed, general } = classifyApps(pkgList, emptyUsage, launcherSet, dexoptMap, {
    maxFrequentlyUsed: 25,
  });

  assert.ok(frequentlyUsed.length > 0, 'Frequently used must have items');
  const frequentPkgs = frequentlyUsed.map((a) => a.packageName);
  assert.ok(frequentPkgs.includes('com.google.android.youtube'));
  assert.ok(frequentPkgs.includes('com.android.chrome'));
  assert.ok(frequentPkgs.includes('jp.naver.line.android'));
  // System app settings remains in general
  assert.ok(general.some((a) => a.packageName === 'com.android.settings'));
});

test('parseUsageStats correctly handles totalTimeUsed and prevents fake 1m for zero usage (Issue #6)', () => {
  const sample = `
  package="tw.goodlife.a_gas" totalTimeUsed="00:00" lastTime="2026-10-06"
  package="com.activitymanager" totalTimeUsed="00:00:00" lastTime="2026-10-06"
  package="com.unused.zero" totalTime="0" lastTime="2026-10-06"
  package="com.google.android.youtube" totalTimeUsed="01:23:45" lastTime="2026-10-06"
  package="com.spotify.music" totalTimeVisible="35m" lastTime="2026-10-06"
  package="org.telegram.messenger" totalTime=12345678 lastTime=98765432
  package="com.android.chrome" timeActive="45000ms" lastTime="2026-10-06"
  `;

  const usageMap = parseUsageStats(sample);

  // Unused or 0-duration apps MUST NOT be in usageMap or set to 60000ms (1m)
  assert.strictEqual(usageMap.has('tw.goodlife.a_gas'), false, '00:00 must not be treated as active usage');
  assert.strictEqual(usageMap.has('com.activitymanager'), false, '00:00:00 must not be treated as active usage');
  assert.strictEqual(usageMap.has('com.unused.zero'), false, '0 must not be treated as active usage');

  // Real usage must be parsed accurately
  assert.ok(usageMap.has('com.google.android.youtube'));
  assert.strictEqual(usageMap.get('com.google.android.youtube').foregroundMs, (1 * 3600 + 23 * 60 + 45) * 1000);

  assert.ok(usageMap.has('com.spotify.music'));
  assert.strictEqual(usageMap.get('com.spotify.music').foregroundMs, 35 * 60000);

  assert.ok(usageMap.has('org.telegram.messenger'));
  assert.strictEqual(usageMap.get('org.telegram.messenger').foregroundMs, 12345678);

  assert.ok(usageMap.has('com.android.chrome'));
  assert.strictEqual(usageMap.get('com.android.chrome').foregroundMs, 45000);
});

test('parseDurationToMs properly distinguishes ms units from minutes', () => {
  assert.strictEqual(parseDurationToMs('15000ms'), 15000);
  assert.strictEqual(parseDurationToMs('15m'), 900000);
  assert.strictEqual(parseDurationToMs('1h 15m'), 4500000);
  assert.strictEqual(parseDurationToMs('00:00'), 0);
  assert.strictEqual(parseDurationToMs('00:00:00'), 0);
  assert.strictEqual(parseDurationToMs('0'), 0);
});

test('classifyApps does not format 0 foregroundMs into fake 1m', () => {
  const pkgList = [
    { packageName: 'tw.goodlife.a_gas', path: '/data/app/agas.apk', isSystem: false },
    { packageName: 'com.activitymanager', path: '/data/app/am.apk', isSystem: false },
    { packageName: 'com.google.android.youtube', path: '/data/app/yt.apk', isSystem: false },
  ];
  const usageMap = new Map([
    ['com.google.android.youtube', { foregroundMs: 3600000 }], // 1 hour
  ]);
  const launcherSet = new Set(['tw.goodlife.a_gas', 'com.activitymanager', 'com.google.android.youtube']);
  const dexoptMap = new Map();

  const { frequentlyUsed } = classifyApps(pkgList, usageMap, launcherSet, dexoptMap);

  const yt = frequentlyUsed.find((a) => a.packageName === 'com.google.android.youtube');
  assert.strictEqual(yt.usageTimeFormatted, '1h');

  const agas = frequentlyUsed.find((a) => a.packageName === 'tw.goodlife.a_gas');
  // agas has 0 usage, so usageTimeFormatted MUST be empty, NOT '1m'
  assert.strictEqual(agas.usageTimeFormatted, '');

  const am = frequentlyUsed.find((a) => a.packageName === 'com.activitymanager');
  assert.strictEqual(am.usageTimeFormatted, '');
});

test('sortApps correctly sorts apps by profile_ready_first', () => {
  const apps = [
    { displayName: 'App Without Profile', hasProfile: false, profileLines: 0 },
    { displayName: 'App Ready High Lines', hasProfile: true, profileLines: 2500 },
    { displayName: 'App Ready Low Lines', hasProfile: true, profileLines: 300 },
    { displayName: 'App Ready Dumpsys State', hasProfile: true, profileLines: null },
    { displayName: 'App Unchecked', hasProfile: undefined, profileLines: 0 },
  ];

  const sorted = sortApps(apps, 'profile_ready_first');

  // Apps with profile: true must come first
  assert.strictEqual(sorted[0].displayName, 'App Ready High Lines');
  assert.strictEqual(sorted[1].displayName, 'App Ready Low Lines');
  assert.strictEqual(sorted[2].displayName, 'App Ready Dumpsys State');
  // Then unchecked (undefined)
  assert.strictEqual(sorted[3].displayName, 'App Unchecked');
  // Finally apps with confirmed no profile
  assert.strictEqual(sorted[4].displayName, 'App Without Profile');
});

test('sortApps correctly sorts apps by profile_none_first', () => {
  const apps = [
    { displayName: 'App Ready', hasProfile: true, profileLines: 1500, status: 'speed-profile' },
    { displayName: 'App Unchecked', hasProfile: undefined, status: 'speed' },
    { displayName: 'App Without Profile Verify', hasProfile: false, profileLines: 0, status: 'verify' },
    { displayName: 'App Without Profile Unknown', hasProfile: false, profileLines: 0, status: 'unknown' },
  ];

  const sorted = sortApps(apps, 'profile_none_first');

  // Apps without profile (hasProfile === false) come first
  assert.strictEqual(sorted[0].hasProfile, false);
  assert.strictEqual(sorted[1].hasProfile, false);
  // Unknown priority higher than verify
  assert.strictEqual(sorted[0].displayName, 'App Without Profile Unknown');
  assert.strictEqual(sorted[1].displayName, 'App Without Profile Verify');
  // Then unchecked
  assert.strictEqual(sorted[2].displayName, 'App Unchecked');
  // Finally app with profile
  assert.strictEqual(sorted[3].displayName, 'App Ready');
});

test('parseDumpsysPackageStream keeps base.apk status when package contains secondary dex files (Issue #9 Problem 1)', () => {
  const sample = `
Dexopt state:
  [jp.naver.line.android]
    path: /data/app/~~lGjQskm1L50EgDBenZAvGQ==/jp.naver.line.android-bY0_iGU5cmE8XKQx0nFSPg==/base.apk
      arm64: [status=speed] [reason=cmdline] [primary-abi]
        [location is /data/app/base.odex]
    known secondary dex files:
      /data/user/0/jp.naver.line.android/app_pccache/5/7DFE2A173A05244DA1972708DDF9CEA0A1001D82/pcam.jar
        arm64: [status=verify] [reason=vdex] [primary-abi]
        class loader context: PCL[];PCL[/data/app/base.apk]
      /data/user/0/jp.naver.line.android/app_pccache/5/914096012F5AC546A98FAB41613AF7AC504A530F/pcam.jar (removed)
        arm64: [status=unknown] [reason=unknown] [primary-abi]
        [location is error]
        class loader context: =UnsupportedClassLoaderContext=
      /data/user/0/jp.naver.line.android/app_pccache/5/BE9A61ABBF5A97C8328BE6223F3E2589CE74306D/pcam.jar
        arm64: [status=verify] [reason=vdex] [primary-abi]
  `;
  const map = parseDumpsysPackageStream(sample);
  const line = map.get('jp.naver.line.android');
  assert.ok(line, 'Must parse jp.naver.line.android');
  // Primary status must be speed (NOT overwritten by pcam.jar's verify)
  assert.strictEqual(line.status, 'speed');
  assert.strictEqual(line.reason, 'cmdline');
  assert.strictEqual(line.hasSecondaryDex, true);
  assert.strictEqual(line.secondaryDex.length, 3);
  assert.strictEqual(line.secondaryDexSummary.total, 3);
  assert.strictEqual(line.secondaryDexSummary.restrictedCount, 1);
});

test('parseDumpsysPackageStream keeps base.apk status when package contains split APKs (Issue #9 Problem 1)', () => {
  const sample = `
Dexopt state:
  [com.shopback.app]
    path: /data/app/~~lcj93QIYstboqQuvtmd-jg==/com.shopback.app-bLT6viwDh09bLIPPREk_ZA==/base.apk
      arm64: [status=speed-profile] [reason=bg-dexopt] [primary-abi]
    path: /data/app/~~lcj93QIYstboqQuvtmd-jg==/com.shopback.app-bLT6viwDh09bLIPPREk_ZA==/split_snapreceipt.apk
      arm64: [status=verify] [reason=vdex-dm] [primary-abi]
  `;
  const map = parseDumpsysPackageStream(sample);
  const sb = map.get('com.shopback.app');
  assert.ok(sb, 'Must parse com.shopback.app');
  assert.strictEqual(sb.status, 'speed-profile');
  assert.strictEqual(sb.reason, 'bg-dexopt');
  assert.strictEqual(sb.splits.length, 1);
  assert.strictEqual(sb.splits[0].name, 'split_snapreceipt.apk');
  assert.strictEqual(sb.splits[0].status, 'verify');
});

test('parseDumpsysPackageStream detects empty package blocks as cannotAot (Issue #9 Problem 3)', () => {
  const sample = `
Dexopt state:
  [com.android.angle]
    path: /product/priv-app/ANGLE/ANGLE.apk
      arm64: [status=speed-profile] [reason=bg-dexopt] [primary-abi]
  [com.android.appsearch.aiseal.config]
  [com.android.backupconfirm]
    path: /system/priv-app/BackupRestoreConfirmation/BackupRestoreConfirmation.apk
      arm64: [status=speed] [reason=cmdline] [primary-abi]
  [com.android.bips.auto_generated_rro_product__]
  [com.android.internal.systemui.navbar.gestural]
  `;
  const map = parseDumpsysPackageStream(sample);

  // Normal apps with paths
  assert.strictEqual(map.get('com.android.angle').status, 'speed-profile');
  assert.strictEqual(map.get('com.android.angle').hasCode, true);
  assert.strictEqual(map.get('com.android.backupconfirm').status, 'speed');

  // Empty blocks (RRO / Config / Navbar)
  const config = map.get('com.android.appsearch.aiseal.config');
  assert.ok(config);
  assert.strictEqual(config.hasCode, false);
  assert.strictEqual(config.status, 'N/A');
  assert.strictEqual(config.reason, 'no-code');

  const rro = map.get('com.android.bips.auto_generated_rro_product__');
  assert.ok(rro);
  assert.strictEqual(rro.hasCode, false);
  assert.strictEqual(rro.status, 'N/A');

  const navbar = map.get('com.android.internal.systemui.navbar.gestural');
  assert.ok(navbar);
  assert.strictEqual(navbar.hasCode, false);
  assert.strictEqual(navbar.status, 'N/A');
});

test('parseUsageStats parses multi-interval stats prioritizing weekly (Issue #9 Problem 4)', () => {
  const sample = `
  In-memory daily stats
    packages
      package=jp.naver.line.android totalTimeUsed="06:16" appLaunchCount=9
      package=com.google.assistant.hubui totalTimeUsed="46:45" appLaunchCount=3
      package=com.recent.app totalTimeUsed="15:00"
  In-memory weekly stats
    packages
      package=jp.naver.line.android totalTimeUsed="1:02:01" appLaunchCount=95
      package=com.recent.app totalTimeUsed="30:00"
  In-memory monthly stats
    packages
      package=jp.naver.line.android totalTimeUsed="6:10:16" appLaunchCount=516
      package=com.stale.app totalTimeUsed="10:00:00"
  In-memory yearly stats
    packages
      package=jp.naver.line.android totalTimeUsed="14:21:54" appLaunchCount=1371
      package=com.google.assistant.hubui totalTimeUsed="36:57:33" appLaunchCount=160
      package=com.stale.app totalTimeUsed="115:33:42" appLaunchCount=1044
  `;
  const usageMap = parseUsageStats(sample);

  assert.ok(usageMap.has('jp.naver.line.android'));
  const line = usageMap.get('jp.naver.line.android');
  // foregroundMs must prioritize weekly (1h 2m 1s = 3721000ms), NOT yearly (14h)
  assert.strictEqual(line.foregroundMs, (1 * 3600 + 2 * 60 + 1) * 1000);
  assert.strictEqual(line.weeklyMs, (1 * 3600 + 2 * 60 + 1) * 1000);

  // Recent app with weekly active time should have a solid weighted score
  const recent = usageMap.get('com.recent.app');
  assert.strictEqual(recent.weeklyMs, 30 * 60 * 1000);
  assert.ok(recent.weightedScore > 0);

  // Stale app with 0 daily/weekly but huge yearly
  const stale = usageMap.get('com.stale.app');
  assert.strictEqual(stale.weeklyMs, 0);
  // Falls back to monthly
  assert.strictEqual(stale.foregroundMs, 10 * 3600 * 1000);
});

test('classifyApps strictly excludes system background services without launcher activity from frequentlyUsed (Issue #9 Problem 4)', () => {
  const pkgList = [
    { packageName: 'jp.naver.line.android', path: '/data/app/line.apk', isSystem: false },
    { packageName: 'com.google.android.youtube', path: '/data/app/yt.apk', isSystem: false },
    { packageName: 'com.google.assistant.hubui', path: '/system/priv-app/HubUI.apk', isSystem: true },
    { packageName: 'com.android.systemui', path: '/system/framework/SystemUI.apk', isSystem: true },
    { packageName: 'com.android.chrome', path: '/system/app/Chrome.apk', isSystem: true }, // System app WITH launcher
  ];

  const usageMap = new Map([
    // HubUI and SystemUI have enormous yearly foreground time
    ['com.google.assistant.hubui', { foregroundMs: 36 * 3600 * 1000, weightedScore: 500000000 }],
    ['com.android.systemui', { foregroundMs: 7 * 3600 * 1000, weightedScore: 300000000 }],
    ['jp.naver.line.android', { foregroundMs: 3600000, weightedScore: 15000000 }],
    ['com.google.android.youtube', { foregroundMs: 2500000, weightedScore: 10000000 }],
    ['com.android.chrome', { foregroundMs: 1800000, weightedScore: 8000000 }],
  ]);

  // HubUI and SystemUI are NOT in launcherSet; Chrome and user apps ARE
  const launcherSet = new Set(['jp.naver.line.android', 'com.google.android.youtube', 'com.android.chrome']);
  const dexoptMap = new Map();

  const { frequentlyUsed, general } = classifyApps(pkgList, usageMap, launcherSet, dexoptMap, {
    maxFrequentlyUsed: 5,
  });

  const frequentPkgs = frequentlyUsed.map((a) => a.packageName);
  const generalPkgs = general.map((a) => a.packageName);

  // HubUI and SystemUI MUST NOT be in frequentlyUsed despite having massive usage time!
  assert.strictEqual(frequentPkgs.includes('com.google.assistant.hubui'), false);
  assert.strictEqual(frequentPkgs.includes('com.android.systemui'), false);
  assert.ok(generalPkgs.includes('com.google.assistant.hubui'));
  assert.ok(generalPkgs.includes('com.android.systemui'));

  // User apps and Chrome (system app WITH launcher) ARE in frequentlyUsed
  assert.ok(frequentPkgs.includes('jp.naver.line.android'));
  assert.ok(frequentPkgs.includes('com.google.android.youtube'));
  assert.ok(frequentPkgs.includes('com.android.chrome'));
});

test('calculateUsagePriorityScore accurately calculates de-accumulated normalized log-utility score', () => {
  // Test 1: Inactive App (all 0)
  assert.strictEqual(calculateUsagePriorityScore({ dailyMs: 0, weeklyMs: 0, monthlyMs: 0, yearlyMs: 0 }), 0);

  // Test 2: App used 60 minutes today only (all cumulative windows equal 60 minutes)
  // TD = 60m -> deltaTD = 60m -> RD = 60
  // TW = 60m -> deltaTW = max(0, 60m - 60m) = 0 -> RW = 0
  // TM = 60m -> deltaTM = 0 -> RM = 0
  // TY = 60m -> deltaTY = 0 -> RY = 0
  // PriorityScore = 0.45 * ln(1 + 60) + 0 + 0 + 0 = 0.45 * 4.110874 = 1.8499
  const scoreToday60m = calculateUsagePriorityScore({
    dailyMs: 60 * 60000,
    weeklyMs: 60 * 60000,
    monthlyMs: 60 * 60000,
    yearlyMs: 60 * 60000,
  });
  assert.strictEqual(scoreToday60m, 1.8499);

  // Test 3: Steady daily user (10 min/day throughout the entire year)
  // TD = 10m -> deltaTD = 10m -> RD = 10
  // TW = 70m -> deltaTW = 60m -> RW = 60 / 6 = 10
  // TM = 300m -> deltaTM = 230m -> RM = 230 / 23 = 10
  // TY = 3650m -> deltaTY = 3350m -> RY = 3350 / 335 = 10
  // PriorityScore = (0.45 + 0.30 + 0.15 + 0.10) * ln(1 + 10) = 1.0 * ln(11) = 2.3979
  const scoreSteadyDaily = calculateUsagePriorityScore({
    dailyMs: 10 * 60000,
    weeklyMs: 70 * 60000,
    monthlyMs: 300 * 60000,
    yearlyMs: 3650 * 60000,
  });
  assert.strictEqual(scoreSteadyDaily, 2.3979);

  // Test 4: Weekend binge user (10 hours on a single weekend day, 0 daily)
  // TD = 0 -> deltaTD = 0 -> RD = 0
  // TW = 600m -> deltaTW = 600m -> RW = 600 / 6 = 100
  // TM = 600m -> deltaTM = 0 -> RM = 0
  // TY = 600m -> deltaTY = 0 -> RY = 0
  // PriorityScore = 0.30 * ln(1 + 100) = 0.30 * ln(101) = 1.3845
  const scoreWeekendBinge = calculateUsagePriorityScore({
    dailyMs: 0,
    weeklyMs: 600 * 60000,
    monthlyMs: 600 * 60000,
    yearlyMs: 600 * 60000,
  });
  assert.strictEqual(scoreWeekendBinge, 1.3845);

  // Crucial Property: Steady everyday communication tool (2.3979) outranks sporadic 10h binge (1.3845)!
  assert.ok(scoreSteadyDaily > scoreWeekendBinge);

  // Test 5: Fallback when only foregroundMs is supplied (legacy/fallback mode)
  const scoreFallback = calculateUsagePriorityScore({ foregroundMs: 60 * 60000 });
  // treated as weeklyMs = 60m -> RW = 60/6 = 10 -> 0.30 * ln(11) = 0.7194
  assert.strictEqual(scoreFallback, 0.7194);
});

test('calculateUsagePriorityScore handles dumpsys reporting anomalies without negative or NaN outputs', () => {
  // Anomaly: TW < TD due to rolling window reset
  const scoreAnomaly = calculateUsagePriorityScore({
    dailyMs: 50 * 60000,
    weeklyMs: 30 * 60000, // smaller than daily
    monthlyMs: 100 * 60000,
    yearlyMs: 200 * 60000,
  });
  assert.ok(scoreAnomaly > 0);
  assert.strictEqual(Number.isNaN(scoreAnomaly), false);

  // Undefined / empty input
  assert.strictEqual(calculateUsagePriorityScore(), 0);
  assert.strictEqual(calculateUsagePriorityScore({}), 0);
});

test('parseUsageStats populates priorityScore and maintains weightedScore compatibility', () => {
  const sample = `
  In-memory daily stats
    packages
      package=jp.naver.line.android totalTimeUsed="10:00" appLaunchCount=15
  In-memory weekly stats
    packages
      package=jp.naver.line.android totalTimeUsed="1:10:00" appLaunchCount=100
  In-memory monthly stats
    packages
      package=jp.naver.line.android totalTimeUsed="5:00:00" appLaunchCount=400
  In-memory yearly stats
    packages
      package=jp.naver.line.android totalTimeUsed="60:50:00" appLaunchCount=4500
  `;

  const map = parseUsageStats(sample);
  assert.ok(map.has('jp.naver.line.android'));
  const line = map.get('jp.naver.line.android');

  assert.ok(typeof line.priorityScore === 'number');
  assert.ok(line.priorityScore > 0);
  assert.strictEqual(line.weightedScore, line.priorityScore);
});

test('classifyApps and sortApps accurately use priorityScore for card ranking and usage_desc sorting', () => {
  const pkgList = [
    { packageName: 'app.daily.tool', path: '/data/app/tool.apk', isSystem: false },
    { packageName: 'app.weekend.binge', path: '/data/app/binge.apk', isSystem: false },
    { packageName: 'app.zero', path: '/data/app/zero.apk', isSystem: false },
  ];

  const usageMap = new Map([
    // Daily steady tool: 10m daily, 70m weekly, 300m monthly, 3650m yearly -> PriorityScore = 2.3979
    ['app.daily.tool', {
      dailyMs: 10 * 60000,
      weeklyMs: 70 * 60000,
      monthlyMs: 300 * 60000,
      yearlyMs: 3650 * 60000,
      foregroundMs: 70 * 60000,
      priorityScore: 2.3979,
    }],
    // Weekend binge app: 0 daily, 600m weekly, 600m monthly, 600m yearly -> PriorityScore = 1.3845
    ['app.weekend.binge', {
      dailyMs: 0,
      weeklyMs: 600 * 60000,
      monthlyMs: 600 * 60000,
      yearlyMs: 600 * 60000,
      foregroundMs: 600 * 60000, // has higher foregroundMs (10h vs 70m), but lower priorityScore!
      priorityScore: 1.3845,
    }],
  ]);

  const launcherSet = new Set(['app.daily.tool', 'app.weekend.binge', 'app.zero']);
  const dexoptMap = new Map();

  const { frequentlyUsed } = classifyApps(pkgList, usageMap, launcherSet, dexoptMap, {
    maxFrequentlyUsed: 5,
  });

  // Verify appRecord retains priorityScore
  const toolApp = frequentlyUsed.find((a) => a.packageName === 'app.daily.tool');
  const bingeApp = frequentlyUsed.find((a) => a.packageName === 'app.weekend.binge');
  assert.ok(toolApp);
  assert.ok(bingeApp);
  assert.strictEqual(toolApp.priorityScore, 2.3979);
  assert.strictEqual(bingeApp.priorityScore, 1.3845);

  // In frequentlyUsed ranking, daily steady tool ranks first because of higher priorityScore
  assert.strictEqual(frequentlyUsed[0].packageName, 'app.daily.tool');
  assert.strictEqual(frequentlyUsed[1].packageName, 'app.weekend.binge');

  // Verify sortApps with 'usage_desc' sorts by priorityScore descending
  const sorted = sortApps([bingeApp, toolApp], 'usage_desc');
  assert.strictEqual(sorted[0].packageName, 'app.daily.tool');
  assert.strictEqual(sorted[1].packageName, 'app.weekend.binge');
});

test('parseSinglePackageDexopt correctly ignores ContentProvider authorities and does not falsely mark app as no-code or N/A', () => {
  const sample = `
Activity Resolver Table:
  Non-Data Actions:
    android.intent.action.MAIN:
      com.com2us.mlbgm.normal.freefull.google.global.android.common/com.com2us.module.manager.ModuleActivity

ContentProvider Authorities:
  [com.com2us.mlbgm.normal.freefull.google.global.android.common.firebaseinitprovider]:
    Provider{ab74755 com.com2us.mlbgm.normal.freefull.google.global.android.common/com.google.firebase.provider.FirebaseInitProvider}
      applicationInfo=ApplicationInfo{21074b2 com.com2us.mlbgm.normal.freefull.google.global.android.common}
  [com.com2us.mlbgm.normal.freefull.google.global.android.common.provider]:
    Provider{bfb56a4 com.com2us.mlbgm.normal.freefull.google.global.android.common/com.hive.base.FileProvider}
      applicationInfo=ApplicationInfo{83c1c03 com.com2us.mlbgm.normal.freefull.google.global.android.common}

Key Set Manager:
  [com.com2us.mlbgm.normal.freefull.google.global.android.common]
      Signing KeySets: 131

Packages:
  Package [com.com2us.mlbgm.normal.freefull.google.global.android.common] (70047a9):
    appId=10309
    pkg=Package{7b31a28 com.com2us.mlbgm.normal.freefull.google.global.android.common}
    codePath=/data/app/~~c_53/com.com2us.mlbgm.normal.freefull.google.global.android.common-xyz==
    installReason=2
    usesLibraries:
      (none)

Dexopt state:
  [com.com2us.mlbgm.normal.freefull.google.global.android.common]
    path: /data/app/~~c_53/com.com2us.mlbgm.normal.freefull.google.global.android.common-xyz==/base.apk
      arm64: [status=speed] [reason=cmdline] [primary-abi]
        [location is /data/app/~~c_53/oat/arm64/base.odex]
    known secondary dex files:
      /data/user/0/com.com2us.mlbgm.normal.freefull.google.global.android.common/app_pccache/5/pcam.jar
        arm64: [status=speed] [reason=cmdline] [primary-abi]
`;

  const parsed = parseSinglePackageDexopt(sample, 'com.com2us.mlbgm.normal.freefull.google.global.android.common');
  assert.strictEqual(parsed.status, 'speed');
  assert.strictEqual(parsed.reason, 'cmdline');
  assert.strictEqual(parsed.hasCode, true);
  assert.strictEqual(parsed.hasSecondaryDex, true);
  assert.strictEqual(parsed.secondaryDex.length, 1);
  assert.strictEqual(parsed.secondaryDex[0].status, 'speed');
  assert.strictEqual(parsed.secondaryDex[0].reason, 'cmdline');
});

test('parseSinglePackageDexopt handles dumpsys where (none) is present under usesLibraryFiles without misclassifying as no-code', () => {
  const sample = `
Package [com.normal.app] (1234):
  codePath=/data/app/~~123/com.normal.app-456==
  usesLibraryFiles: (none)
  installReason=0

Dexopt state:
  [com.normal.app]
    path: /data/app/~~123/com.normal.app-456==/base.apk
      arm64: [status=speed-profile] [reason=bg-dexopt]
`;

  const parsed = parseSinglePackageDexopt(sample, 'com.normal.app');
  assert.strictEqual(parsed.status, 'speed-profile');
  assert.strictEqual(parsed.reason, 'bg-dexopt');
  assert.strictEqual(parsed.hasCode, true);
});

