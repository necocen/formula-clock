// Copies the MathJax runtime and font data that the site self-hosts under
// /vendor/mathjax.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const FONT_PACKAGES = [
  'mathjax-stix2-font',
  'mathjax-termes-font',
  'mathjax-fira-font',
  'mathjax-modern-font',
  'mathjax-euler-font-extension',
];

export function mathjaxAssets(): Plugin {
  return {
    name: 'formula-clock-mathjax',
    async configResolved() {
      // Generated public assets are ignored by Git and copied/served by Vite.
      const vendor = path.join(root, 'public/vendor/mathjax');
      const manifest = JSON.parse(
        await fs.readFile(path.join(root, 'node_modules/@mathjax/src/package.json'), 'utf8'),
      ) as { version: string };
      const marker = path.join(vendor, '.version');
      if (
        await fs.readFile(marker, 'utf8').then(
          (v) => v === manifest.version,
          () => false,
        )
      ) {
        return;
      }
      await fs.rm(vendor, { recursive: true, force: true });
      await fs.cp(path.join(root, 'node_modules/@mathjax/src/bundle'), vendor, {
        recursive: true,
        dereference: true,
      });
      for (const name of FONT_PACKAGES) {
        const source = path.join(root, 'node_modules/@mathjax', name);
        const target = path.join(vendor, 'fonts', name);
        await fs.mkdir(target, { recursive: true });
        await fs.cp(path.join(source, 'svg.js'), path.join(target, 'svg.js'), {
          dereference: true,
        });
        await fs.cp(path.join(source, 'svg'), path.join(target, 'svg'), {
          recursive: true,
          dereference: true,
        });
      }
      await fs.writeFile(marker, manifest.version);
    },
  };
}
