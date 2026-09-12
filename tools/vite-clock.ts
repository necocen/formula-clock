// Only Formula Clock's data format and license markup live here. Vite and the
// Cloudflare plugin own bundling, HTML scripts, WASM and deployment.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { SecondEntries } from '../src/shared/types.ts';
import { renderLicenses } from './licenses.ts';
import { validateTable } from './validate-data.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const VIRTUAL_HOURS = 'virtual:clock-hours';

export function clockContent(): Plugin {
  let licenses: string;
  let manifestJson = '';
  return {
    name: 'formula-clock-content',
    async configResolved() {
      licenses = await renderLicenses(root);
      const data = await fs.readFile(path.join(root, 'data/expressions.json'), 'utf8');
      const table = validateTable(JSON.parse(data));
      // Generated public assets are ignored by Git and copied/served by Vite.
      const folder = path.join(root, 'public/data');
      await fs.rm(folder, { recursive: true, force: true });
      await fs.mkdir(path.join(folder, 'hours'), { recursive: true });
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
      manifestJson = JSON.stringify(
        { schema: 'formula-clock-hours/1', version: hash(JSON.stringify(hours)), hours },
        null,
        2,
      );
      // The served manifest is the recovery path for tabs that outlive a data
      // redeploy; the virtual module bakes the same snapshot into the bundles.
      await fs.writeFile(path.join(folder, 'manifest.json'), manifestJson + '\n');
    },
    resolveId(id) {
      if (id === VIRTUAL_HOURS) return '\0' + VIRTUAL_HOURS;
    },
    load(id) {
      if (id === '\0' + VIRTUAL_HOURS) return `export default ${manifestJson};`;
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const marker = '<!-- clock-licenses -->';
        if (html.split(marker).length !== 2) throw new Error(`Expected exactly one ${marker}`);
        return html.replace(marker, () => licenses);
      },
    },
  };
}
