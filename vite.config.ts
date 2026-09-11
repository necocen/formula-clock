import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { clockContent } from './tools/vite-clock.ts';

const at = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig(({ mode }) => {
  const standalone = mode.startsWith('standalone');
  return {
    root: at('./src/browser'),
    publicDir: standalone ? false : at('./public'),
    plugins: [
      clockContent({ standalone, raw: mode === 'standalone-raw' }),
      ...(standalone
        ? [viteSingleFile()]
        : [
            cloudflare({
              configPath: at('./wrangler.jsonc'),
              viteEnvironment: { name: 'worker' },
              persistState: { path: at('./.wrangler/state') },
            }),
          ]),
    ],
    build: {
      outDir: at(standalone ? './dist/standalone' : './dist'),
      emptyOutDir: true,
      target: 'es2022',
      modulePreload: false,
    },
    ...(!standalone
      ? {
          environments: {
            client: { build: { outDir: at('./dist/site') } },
            worker: { build: { outDir: at('./dist/worker'), minify: true } },
          },
        }
      : {}),
    server: { host: '127.0.0.1', port: 8787, strictPort: true },
    preview: { host: '127.0.0.1', port: 8787, strictPort: true },
  };
});
