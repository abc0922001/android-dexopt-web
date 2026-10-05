import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('index.html uses 2 columns on lg (tablet landscape) to prevent squishing', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

  // Verify all 3 app grids have lg:grid-cols-2
  const gridMatches = html.match(/id="grid(FrequentlyUsed|General|CannotAot)"\s+class="([^"]+)"/g);
  assert.ok(gridMatches && gridMatches.length === 3, 'Expected 3 app grid definitions in index.html');

  for (const match of gridMatches) {
    assert.ok(
      match.includes('lg:grid-cols-2'),
      `Grid should use lg:grid-cols-2 for tablet landscape mode, got: ${match}`
    );
    assert.ok(
      match.includes('xl:grid-cols-3'),
      `Grid should use xl:grid-cols-3 for desktop mode, got: ${match}`
    );
  }
});

test('style.css defines responsive .app-card with container queries', () => {
  const css = fs.readFileSync(path.join(rootDir, 'src/style.css'), 'utf-8');

  // Check container query definition
  assert.ok(css.includes('.app-card'), 'style.css should define .app-card');
  assert.ok(css.includes('container-type: inline-size'), '.app-card should declare container-type: inline-size');
  assert.ok(css.includes('.app-card-header'), 'style.css should define .app-card-header');
  assert.ok(css.includes('@container (min-width: 480px)'), 'style.css should include container query breakpoint');
  assert.ok(css.includes('.app-card-info'), 'style.css should define .app-card-info');
  assert.ok(css.includes('.app-card-actions'), 'style.css should define .app-card-actions');
  assert.ok(css.includes('.app-card-badges'), 'style.css should define .app-card-badges');
});

test('main.js createAppCardHtml returns proper responsive card classes', () => {
  const js = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  assert.ok(js.includes('class="app-card '), 'createAppCardHtml should output app-card class');
  assert.ok(js.includes('class="app-card-header'), 'createAppCardHtml should output app-card-header class');
  assert.ok(js.includes('class="app-card-info '), 'createAppCardHtml should output app-card-info');
  assert.ok(js.includes('class="app-card-actions '), 'createAppCardHtml should output app-card-actions');
  assert.ok(js.includes('class="app-card-badges '), 'createAppCardHtml should output app-card-badges');
});

test('container query dynamically switches header layout in browser engine', (t) => {
  const css = fs.readFileSync(path.join(rootDir, 'src/style.css'), 'utf-8');

  // Locate Chrome or Edge binary
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
    t.skip('No Chromium browser found in standard paths to execute deep container query evaluation');
    return;
  }

  const testHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${css}
</style>
</head>
<body>
<div id="card-compact" class="app-card" style="width: 360px;">
  <div class="app-card-header">
    <div class="app-card-info">Info</div>
    <div class="app-card-actions">
      <button class="btn-force-stop-app">Stop</button>
      <button class="btn-optimize-app">Optimize</button>
    </div>
  </div>
  <div class="app-card-badges">Badges</div>
</div>

<div id="card-wide" class="app-card" style="width: 600px;">
  <div class="app-card-header">
    <div class="app-card-info">Info</div>
    <div class="app-card-actions">
      <button class="btn-force-stop-app">Stop</button>
      <button class="btn-optimize-app">Optimize</button>
    </div>
  </div>
  <div class="app-card-badges">Badges</div>
</div>

<script>
window.addEventListener('DOMContentLoaded', () => {
  const compactHeader = document.querySelector('#card-compact .app-card-header');
  const wideHeader = document.querySelector('#card-wide .app-card-header');

  const result = {
    compactDirection: getComputedStyle(compactHeader).flexDirection,
    wideDirection: getComputedStyle(wideHeader).flexDirection,
  };

  const div = document.createElement('div');
  div.id = 'cq-test-result';
  div.textContent = JSON.stringify(result);
  document.body.appendChild(div);
});
</script>
</body>
</html>`;

  const tmpHtml = path.join(os.tmpdir(), `cq-test-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, testHtml);

  try {
    const stdout = execSync(
      `"${browserPath}" --headless=new --disable-gpu --no-sandbox --dump-dom "file:///${tmpHtml.replace(/\\\\/g, '/')}"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }
    );

    const match = stdout.match(/<div id="cq-test-result">([\s\S]*?)<\/div>/);
    assert.ok(match, 'Expected cq-test-result div in browser DOM dump');

    const result = JSON.parse(match[1]);
    assert.equal(
      result.compactDirection,
      'column',
      'Compact card header (<480px) must stack vertically so titles are not squished'
    );
    assert.equal(
      result.wideDirection,
      'row',
      'Wide card header (>=480px) must align horizontally side-by-side'
    );
  } finally {
    try {
      fs.unlinkSync(tmpHtml);
    } catch {
      // ignore
    }
  }
});
