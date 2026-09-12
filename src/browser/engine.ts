/* Direct @mathjax/src pipeline for the browser, mirroring src/worker/render.ts.
 * All engines share one realm and one registered HTML handler; each engine owns
 * its SVG output jax and font instance, so per-profile axis calibration never
 * leaks across fonts. Font data loads lazily as a per-font chunk.
 */
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { SvgWrapper } from '@mathjax/src/js/output/svg/Wrapper.js';
import { browserAdaptor } from '@mathjax/src/js/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/html/HtmlConfiguration.js';
import type { DisplayOptions } from '../shared/types.ts';

RegisterHTMLHandler(browserAdaptor());

export const version: string = mathjax.version;

// With fontCache:none, MathJax's pathNode keeps the Unicode code but drops its
// size variant. Capture that identity before it is lost. The wrapper prototype
// is a module singleton shared by every engine, so patch it exactly once and
// resolve the owning font through the output jax at call time.
const glyphFonts = new WeakMap<object, string>();
interface PatchedWrapper {
  charNode(this: PatchedWrapper, variant: string, code: string, path: string): SVGElement;
  adaptor: { setAttribute(node: SVGElement, name: string, value: string): void };
  jax: object;
}
const wrapperPrototype = SvgWrapper.prototype as unknown as PatchedWrapper;
const originalCharNode = wrapperPrototype.charNode;
wrapperPrototype.charNode = function (variant, code, path) {
  const node = originalCharNode.call(this, variant, code, path);
  const font = glyphFonts.get(this.jax);
  if (font) this.adaptor.setAttribute(node, 'data-glyph-key', `${font}:${variant}:${code}`);
  return node;
};

const FONTS: Record<DisplayOptions['font'], () => Promise<{ Font: unknown }>> = {
  stix2: () => import('./fonts/font-stix2.ts'),
  termes: () => import('./fonts/font-termes.ts'),
  fira: () => import('./fonts/font-fira.ts'),
  euler: () => import('./fonts/font-euler.ts'),
};

export interface Engine {
  convert(tex: string): Promise<HTMLElement>;
  readonly params: { axis_height: number };
}

export async function createEngine(
  font: DisplayOptions['font'],
  glyphFont: string,
): Promise<Engine> {
  const { Font } = await FONTS[font]();
  const output = new SVG<HTMLElement, Text, Document>({ fontData: Font, fontCache: 'none' });
  glyphFonts.set(output, glyphFont);
  const doc = mathjax.document(document, {
    InputJax: new TeX<HTMLElement, Text, Document>({
      packages: ['base', 'ams', 'newcommand', 'html'],
      formatError(_jax: unknown, error: Error) {
        throw error;
      },
    }),
    OutputJax: output,
  });
  return {
    convert: (tex) =>
      doc.convertPromise(tex, {
        display: true,
        em: 16,
        ex: 8,
        containerWidth: 100000,
      }) as Promise<HTMLElement>,
    get params() {
      return (output.font as { params: { axis_height: number } }).params;
    },
  };
}
