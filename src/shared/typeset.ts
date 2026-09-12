/* MathJax pipeline configuration shared by the browser (src/browser/engine.ts)
 * and the Worker (src/worker/render.ts), so the two renderers cannot drift. */
export const TEX_PACKAGES: readonly string[] = Object.freeze(['base', 'ams', 'newcommand', 'html']);
export const CONVERT_OPTIONS = Object.freeze({
  display: true,
  em: 16,
  ex: 8,
  containerWidth: 100000,
});
