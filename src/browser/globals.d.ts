import type { FormulaProvider, FormulaClockAPI } from '../shared/types.ts';
export {};
declare global {
  var FormulaI18n: typeof import('../shared/i18n.ts').default;
  var FormulaDisplay: typeof import('../shared/display.ts').default;
  var FormulaShare: typeof import('../shared/share.ts').default;
  var FormulaExpression: typeof import('../shared/expression.ts').default;
  var FormulaData: typeof import('../shared/data.ts').default;
  var FormulaSymbols: typeof import('../shared/symbols.ts').default;
  var FormulaTypesetter: typeof import('./typesetter.ts').default;
  interface Document {
    webkitFullscreenElement?: Element | null;
    webkitFullscreenEnabled?: boolean;
    webkitExitFullscreen?(): Promise<void> | void;
  }
  interface HTMLElement {
    webkitRequestFullscreen?(): Promise<void> | void;
  }
  interface Window {
    FormulaClock: FormulaClockAPI;
    webkitAudioContext?: typeof AudioContext;
    FORMULA_CLOCK_CONFIG?: { provider?: FormulaProvider };
  }
}
