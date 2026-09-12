import { MathJaxModernFont } from '@mathjax/mathjax-modern-font/js/svg.js';
import { MathJaxEulerFontExtension } from '@mathjax/mathjax-euler-font-extension/js/svg.js';

// Class-level and not idempotent: this module's single evaluation is the one
// place the Euler alphabet is merged into the Modern base font.
MathJaxModernFont.addExtension(MathJaxEulerFontExtension);

export { MathJaxModernFont as Font };
