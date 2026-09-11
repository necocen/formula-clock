import type { Bounds, DisplayOptions, Expr, SymbolIdentity, Typography } from '../shared/types.ts';
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
// The CDN engine lives in another realm. Describe only the APIs this adapter
// actually uses, including the optional version-specific glyph identity hook.
interface GlyphWrapper {
  charNode(variant: string, code: number, path: string): SVGElement;
  adaptor: { setAttribute(node: SVGElement, name: string, value: string): void };
}
export interface MathJaxRuntime {
  version: string;
  loader: { failed(error: unknown): void };
  tex2svgPromise(
    tex: string,
    options: { display: boolean; em: number; ex: number; containerWidth: number },
  ): Promise<HTMLElement>;
  startup: {
    promise: Promise<void>;
    document: { outputJax: { font: { params: { axis_height: number } } } };
  };
  _?: {
    output?: {
      svg?: {
        Wrapper?: {
          SvgWrapper?: { prototype: GlyphWrapper };
          SVGWrapper?: { prototype: GlyphWrapper };
        };
      };
    };
  };
}
