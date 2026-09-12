import type { DisplayOptions } from '../../shared/types.ts';

/* Static thunk map so the font chunk can download in parallel with the engine
 * chunk (see Typesetter.load) instead of waiting for engine.ts to evaluate. */
export const FONT_LOADERS: Record<DisplayOptions['font'], () => Promise<{ Font: unknown }>> = {
  stix2: () => import('./font-stix2.ts'),
  termes: () => import('./font-termes.ts'),
  fira: () => import('./font-fira.ts'),
  euler: () => import('./font-euler.ts'),
};
