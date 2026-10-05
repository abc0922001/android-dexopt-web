import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('public/sw.js exists with full offline caching strategies', () => {
  const swPath = path.join(rootDir, 'public', 'sw.js');
  assert.ok(fs.existsSync(swPath), 'public/sw.js must exist');

  const swContent = fs.readFileSync(swPath, 'utf-8');
  assert.ok(swContent.includes('CACHE_NAME'), 'sw.js should define CACHE_NAME');
  assert.ok(swContent.includes('addEventListener(\'install\''), 'sw.js should listen to install event');
  assert.ok(swContent.includes('addEventListener(\'activate\''), 'sw.js should listen to activate event');
  assert.ok(swContent.includes('addEventListener(\'fetch\''), 'sw.js should listen to fetch event');
  assert.ok(swContent.includes('caches.delete'), 'sw.js should prune outdated caches');
  assert.ok(swContent.includes('request.mode === \'navigate\''), 'sw.js should handle navigation requests for offline app shell');
});

test('public/manifest.webmanifest is valid PWA manifest', () => {
  const manifestPath = path.join(rootDir, 'public', 'manifest.webmanifest');
  assert.ok(fs.existsSync(manifestPath), 'public/manifest.webmanifest must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(manifest.name, 'Android Dexopt Studio Web');
  assert.strictEqual(manifest.short_name, 'Dexopt Web');
  assert.strictEqual(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest should have icons');
});

test('index.html links manifest, icons and offline indicator', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

  assert.ok(html.includes('rel="manifest"'), 'index.html should link to manifest');
  assert.ok(html.includes('rel="apple-touch-icon"'), 'index.html should specify apple-touch-icon');
  assert.ok(html.includes('id="offlineIndicatorBadge"'), 'index.html should include offlineIndicatorBadge');
  assert.ok(html.includes('mobile-web-app-capable'), 'index.html should include mobile-web-app-capable');
});

test('main.js initializes offline support and registers service worker', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  assert.ok(mainJs.includes('function initOfflineSupport'), 'main.js should define initOfflineSupport');
  assert.ok(mainJs.includes("serviceWorker") && mainJs.includes("register('./sw.js')"), 'main.js should register service worker');
  assert.ok(mainJs.includes("addEventListener('offline'"), 'main.js should listen to offline event');
  assert.ok(mainJs.includes("addEventListener('online'"), 'main.js should listen to online event');
  assert.ok(mainJs.includes('initOfflineSupport()'), 'main.js should call initOfflineSupport on startup');
});
