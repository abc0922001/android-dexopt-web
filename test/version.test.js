import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, getFormattedVersion } from '../src/version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('package.json has valid Semantic Versioning (SemVer) format', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  assert.ok(pkg.version, 'package.json must contain version');
  // SemVer pattern: Major.Minor.Patch(-pre-release)?
  const semverRegex = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;
  assert.ok(semverRegex.test(pkg.version), `Version ${pkg.version} must follow SemVer format (Major.Minor.Patch)`);
});

test('src/version.js exports correct APP_VERSION matching package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  assert.strictEqual(APP_VERSION, pkg.version);
  assert.strictEqual(getFormattedVersion(), `v${pkg.version}`);
});

test('index.html contains appVersion badge and footer version element', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  assert.ok(html.includes('id="appVersion"'), 'index.html must have #appVersion badge in header');
  assert.ok(html.includes('id="footerVersion"'), 'index.html must have #footerVersion element in footer');
});

test('main.js imports version module and binds version display on startup', () => {
  const mainCode = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');
  assert.ok(mainCode.includes("from './version.js'"), 'main.js must import from version.js');
  assert.ok(mainCode.includes('renderAppVersion'), 'main.js must implement and call renderAppVersion');
});
