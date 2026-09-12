import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isRecord } from '../../src/shared/types.ts';
import { renderLicenses } from '../../tools/licenses.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
test('external build exactly partitions the canonical day and publishes only site assets', async () => {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production' },
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
    '.assetsignore',
    '_headers',
    'assets',
    'data',
    'index.html',
    'og-default.png',
  ]);
  const chunks = fs.readdirSync(path.join(dir, 'assets'));
  assert.ok(chunks.some((name) => name.startsWith('engine-')));
  for (const font of ['stix2', 'termes', 'fira', 'euler']) {
    assert.ok(chunks.some((name) => name.startsWith(`font-${font}-`)));
  }
  assert.equal(fs.readdirSync(path.join(dir, 'data/hours')).length, 24);
  assert.ok(!read('index.html').includes('id="clock-data"'));
  assert.ok(read('_headers').includes('max-age=31536000, immutable'));
  assert.ok(read('index.html').includes(await renderLicenses()));
  assert.ok(!read('index.html').includes('<!-- clock-licenses -->'));
  const png = fs.readFileSync(path.join(dir, 'og-default.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const html = read('index.html');
  const script = html.match(/<script type="module" crossorigin src="([^"]+)"/);
  assert.ok(script, 'Vite emits the browser entry as an ES module');
  const js = read(script[1].replace(/^\//, ''));
  assert.ok(js.includes('data/manifest.json'));
  assert.ok(js.includes('FormulaShare'));
  assert.ok(js.includes('FormulaI18n'));
  assert.ok(!js.includes('MathJaxEulerFontExtension'));
  assert.ok(!html.includes('<!-- clock-data -->'));
});
