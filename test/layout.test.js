import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  assert.ok(css.includes('@container (min-width: 480px)'), 'style.css should include container query breakpoint');
  assert.ok(css.includes('.app-card-info'), 'style.css should define .app-card-info');
  assert.ok(css.includes('.app-card-actions'), 'style.css should define .app-card-actions');
  assert.ok(css.includes('.app-card-badges'), 'style.css should define .app-card-badges');
});

test('main.js createAppCardHtml returns proper grid area classes', () => {
  const js = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  assert.ok(js.includes('class="app-card '), 'createAppCardHtml should output app-card class');
  assert.ok(js.includes('class="app-card-info '), 'createAppCardHtml should output app-card-info');
  assert.ok(js.includes('class="app-card-actions '), 'createAppCardHtml should output app-card-actions');
  assert.ok(js.includes('class="app-card-badges '), 'createAppCardHtml should output app-card-badges');
});
