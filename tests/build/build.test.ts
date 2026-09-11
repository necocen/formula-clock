import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isRecord } from '../../src/shared/types.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
test('standalone build embeds the canonical day and licenses without including the solver', () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'tools/build.ts'], { cwd: root });
  const html = fs.readFileSync(path.join(root, 'dist/standalone/index.html'), 'utf8');
  const source: unknown = JSON.parse(
    fs.readFileSync(path.join(root, 'data/expressions.json'), 'utf8'),
  );
  assert.ok(!html.includes('function createSolver'));
  const encoded = html.match(/data-encoding="gzip-base64">([^<]+)/);
  assert.ok(encoded);
  const b64 = encoded[1];
  assert.deepEqual(
    JSON.parse(zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')),
    source,
  );
  assert.ok(html.includes('LaTeX Project Public License'));
  assert.ok(!html.includes('<!-- clock-scripts -->'));
});
test('external build exactly partitions the canonical day and publishes only site assets', () => {
  execFileSync(process.execPath, ['--import', 'tsx', 'tools/build.ts', '--external'], {
    cwd: root,
  });
  const dir = path.join(root, 'dist/site');
  const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
  const manifest: unknown = JSON.parse(read('data/manifest.json'));
  const source: unknown = JSON.parse(
    fs.readFileSync(path.join(root, 'data/expressions.json'), 'utf8'),
  );
  assert.ok(isRecord(manifest) && isRecord(manifest.hours));
  assert.ok(isRecord(source) && isRecord(source.minutes));
  const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
  assert.equal(manifest.schema, 'formula-clock-hours/1');
  assert.equal(manifest.version, hash(JSON.stringify(manifest.hours)));
  assert.equal(Object.keys(manifest.hours).length, 24);
  const combined = {};
  for (let h = 0; h < 24; h++) {
    const hour = String(h).padStart(2, '0');
    const url: unknown = manifest.hours[hour];
    assert.ok(typeof url === 'string');
    const raw = read('data/' + url);
    const table: unknown = JSON.parse(raw);
    assert.ok(isRecord(table) && isRecord(table.minutes));
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
    'og-default.png',
  ]);
  assert.equal(fs.readdirSync(path.join(dir, 'data/hours')).length, 24);
  assert.ok(read('index.html').includes("new FormulaData.FetchHourProvider('data/manifest.json')"));
  assert.ok(!read('index.html').includes('id="clock-data"'));
  assert.ok(read('_headers').includes('max-age=31536000, immutable'));
  assert.ok(read('index.html').includes('LaTeX Project Public License'));
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
