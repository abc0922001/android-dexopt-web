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


