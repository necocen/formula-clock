/** Canonical expression format: ranges are zero-based, end-exclusive HHMM slots. */
export type Expr =
  | { readonly op: 'lit'; readonly i: 0 | 1 | 2 | 3; readonly j: 1 | 2 | 3 | 4 }
  | { [Op in 'neg' | 'sqrt' | 'fact']: { readonly op: Op; readonly a: Expr } }[
      | 'neg'
      | 'sqrt'
      | 'fact']
  | {
      [Op in 'add' | 'sub' | 'mul' | 'div' | 'pow']: {
        readonly op: Op;
        readonly a: Expr;
        readonly b: Expr;
      };
    }['add' | 'sub' | 'mul' | 'div' | 'pow'];

/** Exactly 60 entries, verified before publication. null requests an ordinary clock. */
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
  /** Return canonical, producer-validated data; do not mutate it after publication. */
  getMinute(hhmm: string, options?: { signal?: AbortSignal }): Promise<MinuteRecord>;
}
/** Optional second argument to FormulaData.FetchHourProvider; default is browser fetch. */
export interface FetchHourOptions {
  fetch?: typeof fetch;
  /** Build-baked manifest snapshot adopted without a network round trip. */
  initial?: unknown;
}
export interface DisplayOptions {
  font: 'stix2' | 'termes' | 'fira' | 'euler';
  /** Lining centers mathematical signs on the digits; oldstyle uses the native font axis. */
  numerals: 'lining' | 'oldstyle';
  /** fraction: stacked; inline: ÷; slash: /. */
  division: 'fraction' | 'inline' | 'slash';
  /** Experimental reuse of +, −, ×, ÷ and ! glyphs. Defaults to true. */
  symbolMotion: boolean;
  /** Rule/√/parenthesis motion preference. Defaults to true; retained when symbolMotion is off; active only when it is on. */
  structureMotion: boolean;
  /** Arithmetic morph preference, independent of structureMotion. Defaults to true; retained when symbolMotion is off; active only when it is on. */
  symbolMorph: boolean;
}
export interface SharedClockState extends Pick<DisplayOptions, 'font' | 'numerals' | 'division'> {
  readonly v: 1;
  /** Six ASCII HHMMSS digits, interpreted as a wall-clock reading, without date/timezone. */
  readonly t: string;
}
/** Immutable snapshot; null preserves ordinary clock mode, independently of future datasets. */
export interface SharedSnapshot extends SharedClockState {
  readonly ast: Expr | null;
}
export interface SharedView {
  readonly id: string;
  readonly snapshot: SharedSnapshot;
}
export interface FormulaShareAPI {
  parse(url: string | URL): Readonly<SharedClockState> | null;
  params(state: SharedClockState): URLSearchParams;
  url(origin: string, state: SharedClockState): URL;
  snapshot(value: unknown): Readonly<SharedSnapshot>;
  id(path: string): string | null;
  shortUrl(origin: string, id: string): URL;
  view(value: unknown): Readonly<SharedView>;
  timeLabel(state: SharedClockState): string;
  title(state: (SharedClockState & { readonly ast?: Expr | null }) | null): string;
  card(state: (SharedClockState & { readonly ast?: Expr | null }) | null): {
    title: string;
    description: string | null;
  };
  localDate(time: string): Date;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TexOptions {
  division: DisplayOptions['division'];
  oldstyle: boolean;
  centerOperators: boolean;
  symbolMotion: boolean;
  structureMotion: boolean;
  symbolMorph: boolean;
}
export interface SymbolIdentity {
  kind: string;
  site?: string;
  glyphKey?: string;
  font?: string;
  exiting?: boolean;
}
export interface Typography {
  profile: DisplayOptions['font'];
  numerals: DisplayOptions['numerals'];
  axisMode: 'numeric' | 'font';
  referenceDigit: string;
  originalAxisEm: number;
  numericAxisEm: number;
  axisEm: number;
  zeroTop: number;
  zeroBottom: number;
  equalCenterY: number;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
