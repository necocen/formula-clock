/** Canonical expression format: ranges are zero-based, end-exclusive HHMM slots. */
export type Expr =
  | { readonly op: 'lit'; readonly i: 0 | 1 | 2 | 3; readonly j: 1 | 2 | 3 | 4 }
  | { readonly op: 'neg' | 'sqrt' | 'fact'; readonly a: Expr }
  | { readonly op: 'add' | 'sub' | 'mul' | 'div' | 'pow'; readonly a: Expr; readonly b: Expr };

/** Exactly 60 entries; enforced at runtime. null requests an ordinary clock. */
export type SecondEntries = readonly (Expr | null)[];
export interface MinuteRecord {
  readonly schema: 'formula-clock/1';
  readonly hhmm: string;
  readonly seconds: SecondEntries;
}
export interface FormulaTable {
  readonly schema: 'formula-clock/1';
  readonly minutes: Readonly<Record<string, SecondEntries>>;
}
export interface HourManifest {
  readonly schema: 'formula-clock-hours/1';
  readonly version: string;
  readonly hours: Readonly<Record<string, string>>;
}
export interface FormulaProvider {
  getMinute(hhmm: string, options?: { signal?: AbortSignal }): Promise<MinuteRecord>;
}
export interface DisplayOptions {
  font: 'stix2' | 'euler';
  division: 'fraction' | 'inline';
  /** Experimental reuse of +, −, ×, ÷ and ! glyphs. Defaults to false. */
  symbolMotion: boolean;
}
export interface FormulaClockAPI {
  setDisplay(options: Partial<DisplayOptions>): Promise<void>;
  setDataProvider(provider: FormulaProvider): void;
  preview(time: string | Date, paused?: boolean): void;
  live(): void;
  pause(): void;
  readonly digits: SVGGElement[];
  readonly state: Readonly<Record<string, unknown>>;
  diagnostics(): Record<string, unknown>;
}
declare global {
  interface Window {
    FormulaClock: FormulaClockAPI;
    FORMULA_CLOCK_CONFIG?: { provider?: FormulaProvider };
  }
}
