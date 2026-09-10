import type {FormulaProvider,FormulaClockAPI} from './types.ts';
export {};
declare global {
  var FormulaI18n: typeof import('./i18n.ts').default;
  var FormulaDisplay: typeof import('./display.ts').default;
  var FormulaShare: typeof import('./share.ts').default;
  var FormulaExpression: typeof import('./expression.ts').default;
  var FormulaData: typeof import('./data.ts').default;
  var FormulaSymbols: typeof import('./symbols.ts').default;
  var FormulaTypesetter: typeof import('./typesetter.ts').default;
  interface Document {
    webkitFullscreenElement?: Element | null;
    webkitFullscreenEnabled?: boolean;
    webkitExitFullscreen?(): Promise<void> | void;
  }
  interface HTMLElement { webkitRequestFullscreen?(): Promise<void> | void; }
  interface Window {
    FormulaClock: FormulaClockAPI;
    webkitAudioContext?: typeof AudioContext;
    FORMULA_CLOCK_CONFIG?: {provider?: FormulaProvider};
  }
}
