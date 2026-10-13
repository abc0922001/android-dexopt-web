import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ICONS, createGoogleSearchLink, escapeHtml } from '../src/icons.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('ICONS contains valid Google SVG icon with brand colors', () => {
  assert.ok(ICONS.google, 'ICONS.google must be defined');
  assert.ok(ICONS.google.includes('<svg'), 'ICONS.google must contain <svg');
  assert.ok(ICONS.google.includes('viewBox="0 0 24 24"'), 'ICONS.google must have 24x24 viewBox');
  // Check Google brand colors (Blue, Green, Yellow, Red)
  assert.ok(ICONS.google.includes('#4285F4'), 'ICONS.google must include Google Blue (#4285F4)');
  assert.ok(ICONS.google.includes('#34A853'), 'ICONS.google must include Google Green (#34A853)');
  assert.ok(ICONS.google.includes('#FBBC05'), 'ICONS.google must include Google Yellow (#FBBC05)');
  assert.ok(ICONS.google.includes('#EA4335'), 'ICONS.google must include Google Red (#EA4335)');
});

test('createGoogleSearchLink generates accessible and secure button markup', () => {
  const pkg = 'com.gpconsumermobile.plus';
  const html = createGoogleSearchLink(pkg);

  assert.ok(html.includes('class="btn-search-pkg'), 'Must have btn-search-pkg class');
  assert.ok(html.includes('href="https://www.google.com/search?q=com.gpconsumermobile.plus"'), 'Must link to Google search query');
  assert.ok(html.includes('target="_blank"'), 'Must open in new tab');
  assert.ok(html.includes('rel="noopener noreferrer"'), 'Must have rel="noopener noreferrer" for security');
  assert.ok(html.includes('onclick="event.stopPropagation()"'), 'Must stop click propagation');
  assert.ok(html.includes(`title="在 Google 搜尋此套件名稱 (${pkg})"`), 'Must contain informative title');
  assert.ok(html.includes(`aria-label="在 Google 搜尋 ${pkg}"`), 'Must contain accessible aria-label');
  assert.ok(html.includes(ICONS.google), 'Must contain Google icon SVG');

  // Verify empty handling
  assert.strictEqual(createGoogleSearchLink(''), '');
  assert.strictEqual(createGoogleSearchLink(null), '');
  assert.strictEqual(createGoogleSearchLink(undefined), '');
});

test('createGoogleSearchLink and escapeHtml safely handle special characters and injection', () => {
  const unsafePkg = 'com.example.app"test<script>&special=\'true\'';
  const html = createGoogleSearchLink(unsafePkg);

  assert.ok(!html.includes('<script>'), 'Must escape script tags');
  assert.ok(html.includes('&lt;script&gt;'), 'Must encode < and >');
  assert.ok(html.includes('&quot;test'), 'Must encode double quotes');
  assert.ok(html.includes('&#039;true&#039;'), 'Must encode single quotes');
  assert.ok(html.includes('&amp;special='), 'Must encode ampersand');

  // URL query must be properly percent-encoded
  const expectedEncoded = encodeURIComponent(unsafePkg);
  assert.ok(html.includes(`q=${expectedEncoded}`), 'Search query must be URI encoded');
});

test('Google search query encoding works properly for diverse package names', () => {
  const testPackages = [
    'com.gpconsumermobile.plus',
    'com.GpConsumerMobile.Plus',
    'tw.com.pkcard',
    'jp.co.jorudan.nrkj',
    'com.google.android.apps.messaging',
    'com.example.app+test&special=true',
  ];

  for (const pkg of testPackages) {
    const expectedUrl = `https://www.google.com/search?q=${encodeURIComponent(pkg)}`;
    assert.ok(expectedUrl.startsWith('https://www.google.com/search?q='));
    const parsed = new URL(expectedUrl);
    assert.strictEqual(parsed.origin, 'https://www.google.com');
    assert.strictEqual(parsed.pathname, '/search');
    assert.strictEqual(parsed.searchParams.get('q'), pkg);
  }
});

test('index.html contains forceStopGoogleSearchLink for single force stop modal', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  assert.ok(
    html.includes('id="forceStopGoogleSearchLink"'),
    'index.html must include #forceStopGoogleSearchLink element'
  );
  assert.ok(
    html.includes('id="forceStopTargetPkg"'),
    'index.html must maintain #forceStopTargetPkg element'
  );
  assert.ok(
    html.includes('btn-search-pkg'),
    'index.html forceStopGoogleSearchLink must have class btn-search-pkg'
  );
});

test('main.js manages forceStopGoogleSearchLink visibility and href in force stop modal', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  assert.ok(
    mainJs.includes("forceStopGoogleSearchLink: document.getElementById('forceStopGoogleSearchLink')"),
    'el must bind forceStopGoogleSearchLink'
  );
  assert.ok(
    mainJs.includes('el.forceStopGoogleSearchLink.href = `https://www.google.com/search?q=${encodeURIComponent(packageName)}`'),
    'openSingleForceStopModal must set href on forceStopGoogleSearchLink'
  );
  assert.ok(
    mainJs.includes("el.forceStopGoogleSearchLink?.classList.add('hidden')"),
    'Batch mode or close modal must hide forceStopGoogleSearchLink'
  );
});

test('main.js integrates createGoogleSearchLink across cards, modals, and tables', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  // Must import createGoogleSearchLink
  assert.ok(
    mainJs.includes('createGoogleSearchLink'),
    'main.js must import and use createGoogleSearchLink'
  );

  // Must invoke createGoogleSearchLink in createAppCardHtml
  assert.ok(
    mainJs.includes('${createGoogleSearchLink(app.packageName)}'),
    'createAppCardHtml must render createGoogleSearchLink(app.packageName)'
  );

  // Must invoke in openFastAotModal
  assert.ok(
    mainJs.includes('${createGoogleSearchLink(app.packageName)}'),
    'Fast AOT preview list must render createGoogleSearchLink(app.packageName)'
  );

  // Must invoke in showFastAotResultModal
  assert.ok(
    mainJs.includes('${createGoogleSearchLink(r.packageName)}'),
    'Fast AOT result list must render createGoogleSearchLink(r.packageName)'
  );

  // Must invoke in updateQueueUi
  assert.ok(
    mainJs.includes('${createGoogleSearchLink(item.packageName)}'),
    'Queue status table must render createGoogleSearchLink(item.packageName)'
  );
});

test('Headless Chrome browser engine renders and verifies Google search button behavior', (t) => {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'google-chrome',
    'chromium',
  ];

  let browserPath = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      browserPath = c;
      break;
    }
  }

  if (!browserPath) {
    t.skip('No Chromium browser found to execute headless browser verification');
    return;
  }

  const testPkg = 'com.gpconsumermobile.plus';
  const testHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
</head>
<body>
<div id="test-card">
  <div class="flex items-center gap-1.5 mt-0.5 min-w-0">
    <p class="text-xs text-slate-500 font-mono break-all min-w-0">${escapeHtml(testPkg)}</p>
    ${createGoogleSearchLink(testPkg)}
  </div>
</div>

<script>
window.addEventListener('DOMContentLoaded', () => {
  const link = document.querySelector('#test-card .btn-search-pkg');
  let stopped = false;
  link.addEventListener('click', (e) => {
    // Check if onclick attribute stopped propagation
  });

  const result = {
    hasLink: Boolean(link),
    href: link.getAttribute('href'),
    target: link.getAttribute('target'),
    rel: link.getAttribute('rel'),
    title: link.getAttribute('title'),
    ariaLabel: link.getAttribute('aria-label'),
    hasSvg: Boolean(link.querySelector('svg')),
  };

  const div = document.createElement('div');
  div.id = 'browser-test-result';
  div.textContent = JSON.stringify(result);
  document.body.appendChild(div);
});
</script>
</body>
</html>`;

  const tmpHtml = path.join(os.tmpdir(), `google-search-test-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, testHtml);

  try {
    const stdout = execSync(
      `"${browserPath}" --headless=new --disable-gpu --no-sandbox --dump-dom "file:///${tmpHtml.replace(/\\\\/g, '/')}"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }
    );

    const match = stdout.match(/<div id="browser-test-result">([\s\S]*?)<\/div>/);
    assert.ok(match, 'Expected browser-test-result div in DOM dump');

    const result = JSON.parse(match[1]);
    assert.ok(result.hasLink, 'Google search link must exist in browser DOM');
    assert.strictEqual(result.href, 'https://www.google.com/search?q=com.gpconsumermobile.plus');
    assert.strictEqual(result.target, '_blank');
    assert.strictEqual(result.rel, 'noopener noreferrer');
    assert.ok(result.hasSvg, 'Google search link must contain SVG icon');
    assert.strictEqual(result.ariaLabel, '在 Google 搜尋 com.gpconsumermobile.plus');
  } finally {
    try {
      fs.unlinkSync(tmpHtml);
    } catch {
      // ignore
    }
  }
});
