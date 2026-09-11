import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { initRenderer, renderDefaultOg } from '../worker/render.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist-worker');
const sources = [
  'display.ts',
  'share.ts',
  'expression.ts',
  'data.ts',
  'data/expressions.json',
  'package-lock.json',
  'worker/index.ts',
  'worker/handler.ts',
  'worker/shares.ts',
  'worker/render.ts',
  'worker/brand.ts',
  'i18n.ts',
  'types.ts',
  'worker/types.ts',
  'worker/globals.d.ts',
  'build.ts',
  'tools/build-worker.ts',
];
const hash = createHash('sha256');
for (const name of sources) {
  hash.update(name);
  hash.update(await fs.readFile(path.join(root, name)));
}
const revision = hash.digest('hex').slice(0, 24);
await fs.mkdir(output, { recursive: true });
const wasm = await fs.readFile(path.join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm'));
await fs.writeFile(path.join(output, 'resvg.wasm'), wasm);
await build({
  absWorkingDir: root,
  entryPoints: ['worker/index.ts'],
  outfile: path.join(output, 'index.mjs'),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  define: { OG_RENDER_REVISION: JSON.stringify(revision) },
  plugins: [
    {
      name: 'compiled-wasm',
      setup(builder) {
        builder.onResolve({ filter: /\.wasm$/ }, () => ({ path: './resvg.wasm', external: true }));
      },
    },
  ],
});
await initRenderer(wasm);
const fallback = renderDefaultOg();
await fs.writeFile(path.join(root, 'dist-external/og-default.png'), fallback);
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify({ revision }, null, 2) + '\n');
console.log(`OG renderer ${revision}; default PNG ${fallback.byteLength} bytes`);
