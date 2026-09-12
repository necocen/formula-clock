/* Direct @mathjax/src pipeline for the browser, mirroring src/worker/render.ts.
 * All engines share one realm and one registered HTML handler; each engine owns
 * its SVG output jax and font instance, so per-profile axis calibration never
 * leaks across fonts. Font data loads lazily as a per-font chunk.
 */
// Initialize MathJax's TeX/SVG module graph before importing the wrapper to patch.
import { createMathJax } from '../shared/mathjax/pipeline.ts';
import { SvgWrapper } from '@mathjax/src/js/output/svg/Wrapper.js';
import { browserAdaptor } from '@mathjax/src/js/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
export { version } from '../shared/mathjax/pipeline.ts';

RegisterHTMLHandler(browserAdaptor());

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

export interface Engine {
  convert(tex: string): Promise<HTMLElement>;
  readonly params: { axis_height: number };
}

export function createEngine(Font: unknown, glyphFont: string): Engine {
  const engine = createMathJax<HTMLElement, Text, Document>(document, Font);
  glyphFonts.set(engine.output, glyphFont);
  return {
    convert: (tex) => engine.convert(tex) as Promise<HTMLElement>,
    params: engine.params,
  };
}
