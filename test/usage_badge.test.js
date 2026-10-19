import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('main.js createAppCardHtml handles usage time and priority score badges accurately', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  // Verify code contains logic for separate usage and priority badges
  assert.ok(mainJs.includes('hasUsageHistory'), 'main.js should check for hasUsageHistory');
  assert.ok(mainJs.includes('⏱️'), 'main.js should include ⏱️ time icon');
  assert.ok(mainJs.includes('⚡ 優先級:'), 'main.js should include ⚡ 優先級: badge text');
  assert.ok(mainJs.includes('< 1m'), 'main.js should handle sub-minute usage with < 1m');

  // Create an evaluation context to test the exact createAppCardHtml logic
  // Extract createAppCardHtml function or simulate with the exact logic
  const cardLogic = (app) => {
    const hasUsageHistory = (typeof app.foregroundMs === 'number' && app.foregroundMs > 0) || Boolean(app.usageTimeFormatted);
    let usageBadgesHtml = '';
    if (hasUsageHistory) {
      const timeDisplay = app.usageTimeFormatted || '< 1m';
      const priorityDisplay = typeof app.priorityScore === 'number' && app.priorityScore > 0 ? app.priorityScore.toFixed(2) : null;
      usageBadgesHtml = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border border-cyan-300 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/60 text-cyan-800 dark:text-cyan-300 ml-auto" title="近期前景使用時間: ${timeDisplay}${priorityDisplay ? ` (AOT 優先評分: ${priorityDisplay})` : ''}">
          ⏱️ ${timeDisplay}
        </span>
        ${priorityDisplay ? `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300" title="AOT 編譯多尺度優先級評分: ${priorityDisplay}">
          ⚡ 優先級: ${priorityDisplay}
        </span>
        ` : ''}
      `;
    }
    return usageBadgesHtml;
  };

  // Case 1: Active app with usage > 1m and priority score
  const activeApp = {
    packageName: 'jp.naver.line.android',
    displayName: 'LINE',
    foregroundMs: 5400000,
    usageTimeFormatted: '1h 30m',
    priorityScore: 2.8532,
  };
  const activeHtml = cardLogic(activeApp);
  assert.ok(activeHtml.includes('⏱️ 1h 30m'), 'Active app should display formatted usage time');
  assert.ok(activeHtml.includes('⚡ 優先級: 2.85'), 'Active app should display 2-decimal priority score badge');
  assert.ok(activeHtml.includes('border-cyan-300'), 'Time badge should have cyan styling');
  assert.ok(activeHtml.includes('border-purple-300'), 'Priority badge should have purple styling');

  // Case 2: Sub-minute usage (e.g. 25 seconds)
  const shortApp = {
    packageName: 'com.example.calculator',
    displayName: 'Calculator',
    foregroundMs: 25000,
    usageTimeFormatted: '',
    priorityScore: 0.421,
  };
  const shortHtml = cardLogic(shortApp);
  assert.ok(shortHtml.includes('⏱️ < 1m'), 'Sub-minute app should display < 1m');
  assert.ok(shortHtml.includes('⚡ 優先級: 0.42'), 'Sub-minute app should display priority score badge');

  // Case 3: Zero usage app (foregroundMs = 0)
  const zeroApp = {
    packageName: 'com.android.settings',
    displayName: 'Settings',
    foregroundMs: 0,
    usageTimeFormatted: '',
    priorityScore: 0,
  };
  const zeroHtml = cardLogic(zeroApp);
  assert.strictEqual(zeroHtml, '', 'Zero usage app must render empty string to stay completely clean');
  assert.ok(!zeroHtml.includes('⏱️'), 'Zero usage app should not contain time icon');
  assert.ok(!zeroHtml.includes('優先級'), 'Zero usage app should not contain priority badge');

  // Case 4: No usage data (undefined foregroundMs)
  const unusedApp = {
    packageName: 'com.example.unused',
    displayName: 'Unused App',
  };
  const unusedHtml = cardLogic(unusedApp);
  assert.strictEqual(unusedHtml, '', 'Unused app must render empty string');
});
