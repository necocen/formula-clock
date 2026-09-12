import type { DisplayOptions } from '../shared/types.ts';

/* Static thunk map so the font chunk can download in parallel with the engine
 * chunk (see Typesetter.load) instead of waiting for engine.ts to evaluate. */
export const FONT_LOADERS: Record<DisplayOptions['font'], () => Promise<{ Font: unknown }>> = {
  stix2: () => import('../shared/mathjax/fonts/font-stix2.ts'),
  termes: () => import('../shared/mathjax/fonts/font-termes.ts'),
  fira: () => import('../shared/mathjax/fonts/font-fira.ts'),
  euler: () => import('../shared/mathjax/fonts/font-euler.ts'),
};
