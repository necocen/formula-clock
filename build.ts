// Build a standalone HTML, or an HTTP site with one content-addressed JSON per hour.
// Browser fonts stay on the CDN; the Worker renderer is bundled separately.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { FormulaTable, SecondEntries } from './types.ts';
const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
// Bundled JavaScript stays inline: opening index.html needs no module server or
// TypeScript runtime. Bootstrap globals exist before a custom provider is set.
const bundle = (entry: string) =>
  buildSync({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'inline',
  }).outputFiles[0].text;
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');
const external = process.argv.includes('--external'),
  raw = process.argv.includes('--raw-json');
const outDir = external ? path.join(root, 'dist-external') : root;
// Only the dedicated generated directory is cleaned. Never publish the repository root.
if (external) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const licenseContent = read('licenses.html').match(
  /<!-- licenses-content:start -->([\s\S]*?)<!-- licenses-content:end -->/,
);
if (!licenseContent) throw new Error('License content markers are missing');
const template = read('_head.html').replace('<!-- licenses-content -->', () => licenseContent[1]);
if (!template.includes('<!-- clock-scripts -->')) throw new Error('Clock script marker is missing');
let scripts = `<script id="browser-code">\n${bundle('browser.ts')}\n</script>\n`;
const data = read('data/expressions.json');
if (external) {
  const table: FormulaTable = JSON.parse(data);
  const folder = path.join(outDir, 'data', 'hours');
  fs.mkdirSync(folder, { recursive: true });
  const hours: Record<string, string> = {};
  const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  for (let h = 0; h < 24; h++) {
    const hour = String(h).padStart(2, '0'),
      minutes: Record<string, SecondEntries> = {};
    for (let m = 0; m < 60; m++) {
      const code = hour + String(m).padStart(2, '0');
      if (!Object.hasOwn(table.minutes, code)) throw new Error(`Missing source minute ${code}`);
      minutes[code] = table.minutes[code];
    }
    const json = JSON.stringify({ schema: table.schema, minutes }) + '\n',
      filename = `${hour}.${hash(json)}.json`;
    fs.writeFileSync(path.join(folder, filename), json);
    hours[hour] = `hours/${filename}`;
  }
  const manifest = { schema: 'formula-clock-hours/1', version: hash(JSON.stringify(hours)), hours };
  fs.writeFileSync(
    path.join(outDir, 'data', 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  fs.copyFileSync(path.join(root, '_headers'), path.join(outDir, '_headers'));
  scripts += `<script>window.FORMULA_CLOCK_CONFIG={provider:new FormulaData.FetchHourProvider('data/manifest.json')};</script>\n`;
} else if (raw) {
  scripts += `<script id="clock-data" type="application/json">${data.replace(/</g, '\\u003c')}</script>\n`;
} else {
  scripts += `<script id="clock-data" type="application/octet-stream" data-encoding="gzip-base64">${zlib.gzipSync(data, { level: 9 }).toString('base64')}</script>\n`;
}
scripts += `<script id="app-code">\n${bundle('app.ts')}\n</script>\n`;
const html = template.replace('<!-- clock-scripts -->', () => scripts);
fs.writeFileSync(path.join(outDir, 'index.html'), html);
if (external) fs.copyFileSync(path.join(root, 'licenses.html'), path.join(outDir, 'licenses.html'));
if (external)
  execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'tools/build-worker.ts')], {
    cwd: root,
    stdio: 'inherit',
  });
console.log(
  `${outDir}/index.html: ${Buffer.byteLength(html)} bytes (${external ? 'async hourly JSON' : raw ? 'embedded JSON' : 'embedded gzip JSON'})`,
);
