import type { FormulaProvider, FormulaClockAPI } from '../shared/types.ts';
export {};
declare global {
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
