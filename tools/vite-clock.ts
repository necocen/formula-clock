// Only Formula Clock's data format and license markup live here. Vite and its
// Cloudflare/singlefile plugins own bundling, HTML scripts, WASM and deployment.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { FormulaTable, SecondEntries } from '../src/shared/types.ts';
import { renderLicenses } from './licenses.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function clockContent({ standalone, raw }: { standalone: boolean; raw: boolean }): Plugin {
  let licenses: string;
  let embedded = '';
  return {
    name: 'formula-clock-content',
    async configResolved() {
      licenses = await renderLicenses(root);
      const data = await fs.readFile(path.join(root, 'data/expressions.json'), 'utf8');
      if (standalone) {
        embedded = raw
          ? `<script id="clock-data" type="application/json">${data.replace(/</g, '\\u003c')}</script>`
          : `<script id="clock-data" type="application/octet-stream" data-encoding="gzip-base64">${zlib.gzipSync(data, { level: 9 }).toString('base64')}</script>`;
        return;
      }
      // Generated public assets are ignored by Git and copied/served by Vite.
      const folder = path.join(root, 'public/data');
      await fs.rm(folder, { recursive: true, force: true });
      await fs.mkdir(path.join(folder, 'hours'), { recursive: true });
      const table: FormulaTable = JSON.parse(data);
      const hours: Record<string, string> = {};
      for (let h = 0; h < 24; h++) {
        const hour = String(h).padStart(2, '0');
        const minutes: Record<string, SecondEntries> = {};
        for (let m = 0; m < 60; m++) {
          const code = hour + String(m).padStart(2, '0');
          if (!Object.hasOwn(table.minutes, code)) throw new Error(`Missing source minute ${code}`);
          minutes[code] = table.minutes[code];
        }
        const json = JSON.stringify({ schema: table.schema, minutes }) + '\n';
        hours[hour] = `hours/${hour}.${hash(json)}.json`;
        await fs.writeFile(path.join(folder, hours[hour]), json);
      }
      await fs.writeFile(
        path.join(folder, 'manifest.json'),
        JSON.stringify(
          { schema: 'formula-clock-hours/1', version: hash(JSON.stringify(hours)), hours },
          null,
          2,
        ) + '\n',
      );
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        for (const marker of ['<!-- clock-licenses -->', '<!-- clock-data -->']) {
          if (html.split(marker).length !== 2) throw new Error(`Expected exactly one ${marker}`);
        }
        return html
          .replace('<!-- clock-licenses -->', () => licenses)
          .replace('<!-- clock-data -->', () => embedded);
      },
    },
  };
}
