'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('external build exactly partitions the canonical day and publishes only site assets', () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'build.ts', '--external'], { cwd: root });
  const dir = path.join(root, 'dist-external');
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const manifest = JSON.parse(read('data/manifest.json'));
  const source = JSON.parse(fs.readFileSync(path.join(root, 'data/expressions.json'), 'utf8'));
  const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
  assert.equal(manifest.schema, 'formula-clock-hours/1');
  assert.equal(manifest.version, hash(JSON.stringify(manifest.hours)));
  assert.equal(Object.keys(manifest.hours).length, 24);
  const combined = {};
  for (let h = 0; h < 24; h++) {
    const hour = String(h).padStart(2, '0'),
      url = manifest.hours[hour],
      raw = read('data/' + url),
      table = JSON.parse(raw);
    assert.equal(url, `hours/${hour}.${hash(raw)}.json`);
    assert.equal(table.schema, source.schema);
    assert.equal(Object.keys(table.minutes).length, 60);
    assert.ok(Object.keys(table.minutes).every((code) => code.startsWith(hour)));
    Object.assign(combined, table.minutes);
  }
  assert.deepEqual(combined, source.minutes);
  assert.deepEqual(fs.readdirSync(dir).sort(), [
    '_headers',
    'data',
    'index.html',
    'licenses.html',
    'og-default.png',
  ]);
  assert.equal(fs.readdirSync(path.join(dir, 'data/hours')).length, 24);
  assert.ok(read('index.html').includes("new FormulaData.FetchHourProvider('data/manifest.json')"));
  assert.ok(!read('index.html').includes('id="clock-data"'));
  assert.ok(read('_headers').includes('max-age=31536000, immutable'));
  assert.ok(read('licenses.html').includes('LaTeX Project Public License'));
  const png = fs.readFileSync(path.join(dir, 'og-default.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(read('index.html').includes('id="browser-code"'));
  const html = read('index.html');
  const bootstrap = html.indexOf('<script id="browser-code">');
  const provider = html.indexOf('<script>window.FORMULA_CLOCK_CONFIG=');
  const app = html.indexOf('<script id="app-code">');
  assert.ok(bootstrap < provider && provider < app && app < html.lastIndexOf('</body>'));
  assert.ok(!html.includes('<!-- clock-scripts -->'));
  assert.ok(read('index.html').includes('FormulaShare'));
  assert.ok(read('index.html').includes('FormulaI18n'));
  assert.ok(!read('index.html').includes('MathJaxEulerFontExtension'));
});
