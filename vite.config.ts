import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { clockContent } from './tools/vite-clock.ts';
import { preloadHints } from './tools/vite-preload.ts';

const at = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  root: at('./src/browser'),
  publicDir: at('./public'),
  plugins: [
    clockContent(),
    preloadHints(),
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
    // The MathJax engine and per-font data ship as deliberate, lazily loaded
    // self-contained chunks (engine ~1.34 MB / fonts up to ~1 MB minified).
    // Keep the warning armed just above them so new accidental bloat still trips it.
    chunkSizeWarningLimit: 1400,
  },
  environments: {
    client: { build: { outDir: at('./dist/site') } },
    worker: { build: { outDir: at('./dist/worker'), minify: true } },
  },
  server: { host: '127.0.0.1', port: 8787, strictPort: true },
  preview: { host: '127.0.0.1', port: 8787, strictPort: true },
});
