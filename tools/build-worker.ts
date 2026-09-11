import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { initRenderer, renderDefaultOg } from '../src/worker/render.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/worker');
const sources = [
  'src/shared/display.ts',
  'src/shared/share.ts',
  'src/shared/expression.ts',
  'src/shared/data.ts',
  'data/expressions.json',
  'package-lock.json',
  'src/worker/index.ts',
  'src/worker/handler.ts',
  'src/worker/shares.ts',
  'src/worker/render.ts',
  'src/worker/brand.ts',
  'src/shared/i18n.ts',
  'src/shared/types.ts',
  'src/worker/types.ts',
  'src/worker/globals.d.ts',
  'tools/build.ts',
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
  entryPoints: ['src/worker/index.ts'],
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
await fs.writeFile(path.join(root, 'dist/site/og-default.png'), fallback);
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify({ revision }, null, 2) + '\n');
console.log(`OG renderer ${revision}; default PNG ${fallback.byteLength} bytes`);
