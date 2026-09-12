import type { FormulaProvider } from '../shared/types.ts';
import type { FormulaClockAPI } from './types.ts';
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
