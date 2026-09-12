import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import type { MathDocument } from '@mathjax/src/js/core/MathDocument.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/html/HtmlConfiguration.js';
import { CONVERT_OPTIONS, TEX_PACKAGES } from '../typeset.ts';

export const version: string = mathjax.version;

/** The caller registers its platform adaptor. Every pipeline owns its font and SVG output. */
export function createMathJax<N, T, D>(root: D | string, Font: unknown) {
  const output = new SVG<N, T, D>({ fontData: Font, fontCache: 'none' });
  const document: MathDocument<N, T, D> = mathjax.document(root, {
    InputJax: new TeX<N, T, D>({
      packages: [...TEX_PACKAGES],
      formatError(_jax: unknown, error: Error) {
        throw error;
      },
    }),
    OutputJax: output,
  });
  return {
    output,
    params: output.font.params,
    convert: (tex: string) => document.convertPromise(tex, { ...CONVERT_OPTIONS }),
  };
}

export type MathJaxEngine<N, T, D> = ReturnType<typeof createMathJax<N, T, D>>;
