import type {
  Bounds,
  DisplayOptions,
  Expr,
  FormulaProvider,
  SymbolIdentity,
  Typography,
} from '../shared/types.ts';
import type { MessageKey } from '../shared/i18n.ts';
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
export interface DisplayedFrame {
  frame: Frame;
  ast: Expr | null;
  code: string;
  seconds: number;
  view: DisplayOptions;
}
export interface PlacedToken extends SymbolIdentity {
  slot: string;
  text: string;
  matrix: number[];
  shape: SVGGElement;
  bounds?: Bounds;
  inkCenter?: number[];
}
export interface GlyphToken extends PlacedToken {
  bounds: Bounds;
  inkCenter: number[];
}
export interface Frame {
  tex: string;
  viewBox: Bounds;
  tokens: GlyphToken[];
  colons: GlyphToken[];
  equality: GlyphToken | null;
  symbols: PlacedToken[];
  decorations: SVGGElement;
  axisY: number;
  typography: Typography;
  font: DisplayOptions['font'];
  numerals: DisplayOptions['numerals'];
}
export interface ClockFace {
  font: DisplayOptions['font'];
  numerals: DisplayOptions['numerals'];
  scale: number;
  glyphs: Readonly<Record<string, GlyphToken>>;
}

export interface FormulaClockAPI {
  /** Saves selected preferences. Disabled motion options retain their values and resume when their prerequisite is on. */
  setDisplay(options: Partial<DisplayOptions>): Promise<void>;
  /** Providers must supply canonical data already validated by their producer. */
  setDataProvider(provider: FormulaProvider): void;
  preview(time: string | Date, paused?: boolean): void;
  live(): void;
  /** Freeze the displayed second. Repeated calls leave it paused. */
  pause(): void;
  readonly digits: SVGGElement[];
  readonly state: Readonly<ClockState>;
  diagnostics(): ClockDiagnostics;
}
export interface LayoutItem {
  slot: string;
  text: string;
  matrix: number[];
  localMatrix: number[];
  scale: number;
}
export interface ClockLayout {
  display: DisplayOptions;
  ast: Expr | null;
  code: string;
  seconds: number;
  mode: 'formula' | 'time';
  tex: string;
  items: LayoutItem[];
  width: number;
  height: number;
  viewBox: Bounds;
  fontSize: number;
  axisY: number;
  localAxisY: number;
  fit: number[];
  typography: Typography;
}
export interface AudioEvent {
  type: 'minute' | 'ten-second' | 'countdown' | 'second';
  time: number;
  frequency: number;
  duration: number;
}
export interface ClockState {
  display: DisplayOptions;
  dataRevision: number;
  dataError: string | null;
  now: string;
  preview: boolean;
  paused: boolean;
  layout: ClockLayout | null;
  coverage: number | undefined;
  audio: AudioEvent[];
  soundEnabled: boolean;
  soundReady: boolean;
  soundVolume: number;
  engineReady: boolean;
  engineError: string | null;
  typesetCacheSize: number;
}
export interface GlyphDiagnostic {
  text: string | undefined;
  transform: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  inStage: boolean;
  opacity: string;
  visibility: string;
}
export interface ClockDiagnostics {
  build: string;
  mathjax: string | null;
  display: DisplayOptions;
  userAgent: string;
  locale: 'ja' | 'en';
  engineError: string | null;
  typography: Typography | null;
  axisY: number | undefined;
  localAxisY: number | undefined;
  time: string | null;
  glyphs: GlyphDiagnostic[];
}

export interface FrameCommit {
  code: string;
  seconds: number;
  loading: boolean;
  view: DisplayOptions;
  ast: Expr | null;
}
