import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { clockContent } from './tools/vite-clock.ts';
import { mathjaxAssets } from './tools/vite-mathjax.ts';

const at = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  root: at('./src/browser'),
  publicDir: at('./public'),
  plugins: [
    clockContent(),
    mathjaxAssets(),
    cloudflare({
      configPath: at('./wrangler.jsonc'),
      viteEnvironment: { name: 'worker' },
      persistState: { path: at('./.wrangler/state') },
    }),
  ],
  build: {
    outDir: at('./dist'),
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
  },
  environments: {
    client: { build: { outDir: at('./dist/site') } },
    worker: { build: { outDir: at('./dist/worker'), minify: true } },
  },
  server: { host: '127.0.0.1', port: 8787, strictPort: true },
  preview: { host: '127.0.0.1', port: 8787, strictPort: true },
});
