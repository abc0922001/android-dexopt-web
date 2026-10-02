import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePackageList,
  parseUsageStats,
  parseLauncherActivities,
  parseDumpsysPackageStream,
  parseSinglePackageDexopt,
  classifyApps,
  formatDisplayName,
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

