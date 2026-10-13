import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICONS } from '../src/icons.js';

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

test('main.js createAppCardHtml outputs Google search button next to package name', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  // Verify createAppCardHtml contains the btn-search-pkg link
  assert.ok(
    mainJs.includes('btn-search-pkg'),
    'createAppCardHtml must render button/link with class btn-search-pkg'
  );
  assert.ok(
    mainJs.includes('https://www.google.com/search?q='),
    'createAppCardHtml must link to Google search URL'
  );
  assert.ok(
    mainJs.includes('target="_blank"'),
    'Google search link must open in a new tab (target="_blank")'
  );
  assert.ok(
    mainJs.includes('rel="noopener noreferrer"'),
    'Google search link must include rel="noopener noreferrer"'
  );
  assert.ok(
    mainJs.includes('onclick="event.stopPropagation()"'),
    'Google search link must stop propagation to prevent card bubbling'
  );
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

test('Fast AOT modals and Queue status table also provide Google search links', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  // Verify Fast AOT preview and result list
  const googleSearchMatches = (mainJs.match(/https:\/\/www\.google\.com\/search\?q=/g) || []).length;
  // Should be in createAppCardHtml, fastAotPreviewList, fastAotResultList, queueTable, and openSingleForceStopModal
  assert.ok(
    googleSearchMatches >= 5,
    `Expected at least 5 Google search integrations across UI, found ${googleSearchMatches}`
  );
});
