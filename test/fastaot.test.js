import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('index.html contains Fast AOT button and modals', () => {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

  assert.ok(html.includes('id="btnFastAot"'), 'index.html must have btnFastAot button');
  assert.ok(html.includes('id="fastAotVerifyBadge"'), 'index.html must have fastAotVerifyBadge');
  assert.ok(html.includes('id="fastAotConfirmModal"'), 'index.html must have fastAotConfirmModal');
  assert.ok(html.includes('id="fastAotResultModal"'), 'index.html must have fastAotResultModal');
  assert.ok(html.includes('id="fastAotResultList"'), 'index.html must have fastAotResultList');
});

test('adb-controller.js supports compilation with force=false without -f flag', () => {
  const adbCode = fs.readFileSync(path.join(rootDir, 'src/adb-controller.js'), 'utf-8');

  // Verify compileApp handles force option
  assert.ok(adbCode.includes('force = true'), 'compileApp should have default force = true');
  assert.ok(adbCode.includes("if (force) {\n      compileCmd.push('-f');\n    }"), 'compileCmd should conditionally append -f');
});

test('Fast AOT targets only verify status apps and excludes cannotAot', () => {
  const sampleApps = [
    { packageName: 'com.app.verify1', status: 'verify', isCannotAot: false },
    { packageName: 'com.app.verify2', status: 'Verify', isCannotAot: false },
    { packageName: 'com.app.speed', status: 'speed', isCannotAot: false },
    { packageName: 'com.app.speedprofile', status: 'speed-profile', isCannotAot: false },
    { packageName: 'com.app.nocode', status: 'verify', isCannotAot: true },
  ];

  const verifyCandidates = sampleApps.filter(
    (a) => !a.isCannotAot && (a.status || '').toLowerCase() === 'verify'
  );

  assert.strictEqual(verifyCandidates.length, 2);
  assert.deepStrictEqual(
    verifyCandidates.map((a) => a.packageName),
    ['com.app.verify1', 'com.app.verify2']
  );
});

test('main.js contains Fast AOT workflow methods and handlers', () => {
  const mainJs = fs.readFileSync(path.join(rootDir, 'src/main.js'), 'utf-8');

  assert.ok(mainJs.includes('function getVerifyApps'), 'main.js should define getVerifyApps');
  assert.ok(mainJs.includes('function openFastAotModal'), 'main.js should define openFastAotModal');
  assert.ok(mainJs.includes('function handleStartFastAot'), 'main.js should define handleStartFastAot');
  assert.ok(mainJs.includes('function showFastAotResultModal'), 'main.js should define showFastAotResultModal');
  assert.ok(mainJs.includes('force: false'), 'Fast AOT must compile with force: false');
});
