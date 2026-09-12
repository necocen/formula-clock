// Preload hints for the lazily imported MathJax chunks: first-time visitors
// always need the engine plus the default STIX Two font, so let both start
// downloading with the HTML instead of after the entry module evaluates.
import type { Plugin } from 'vite';

export function preloadHints(): Plugin {
  return {
    name: 'formula-clock-preload',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        return Object.keys(ctx.bundle)
          .filter((file) => /^assets\/(engine|font-stix2)-/.test(file))
          .map((file) => ({
            tag: 'link',
            attrs: { rel: 'modulepreload', href: '/' + file },
            injectTo: 'head' as const,
          }));
      },
    },
  };
}
