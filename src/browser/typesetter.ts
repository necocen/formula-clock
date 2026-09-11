import type { DisplayOptions, Expr, TexOptions, Typography } from '../shared/types.ts';
import type { ClockFace, Frame, GlyphToken, PlacedToken, MathJaxRuntime } from './types.ts';
/* TeX -> SVG layout adapter. MathJax owns typography; the clock owns animation.
 * No font files are bundled. MathJax and its font extensions load from the CDN.
 */
const NS = 'http://www.w3.org/2000/svg';
import * as Expression from '../shared/expression.ts';
const { expressionTex, frameTex, mark, relation } = Expression;
import * as Display from '../shared/display.ts';
const { PROFILES, NUMERALS } = Display;
const matrixArray = (m: DOMMatrixReadOnly) => [m.a, m.b, m.c, m.d, m.e, m.f];
function finiteMatrix(m: DOMMatrixReadOnly) {
  return matrixArray(m).every(Number.isFinite);
}

function pathBounds(scope: Element | null, inverse: DOMMatrix) {
  const paths = [...(scope?.querySelectorAll('path') || [])];
  if (!paths.length) throw new Error('Missing paths during axis measurement');
  const points = [];
  for (const path of paths) {
    const ctm = path.getScreenCTM();
    if (!ctm) throw new Error('Missing path coordinates during axis measurement');
    const m = inverse.multiply(ctm),
      b = path.getBBox();
    for (const [x, y] of [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ]) {
      points.push(new DOMPoint(x, y).matrixTransform(m));
    }
  }
  const top = Math.min(...points.map((p) => p.y));
  const bottom = Math.max(...points.map((p) => p.y));
  if (!Number.isFinite(top + bottom) || bottom <= top) {
    throw new Error('Invalid glyph bounds during axis measurement');
  }
  return { top, bottom, centerY: (top + bottom) / 2 };
}

class Typesetter {
  readonly profile: Omit<Display.Profile, 'label'> & { readonly label: string };
  mathjax: MathJaxRuntime | null = null;
  private host: HTMLIFrameElement;
  private staging: HTMLDivElement;
  readonly cache = new Map<string, Promise<Frame>>();
  private tail: Promise<unknown> = Promise.resolve();
  private clockFaceTask?: Promise<ClockFace>;
  readonly boot: Promise<void>;
  ready = false;
  error: unknown = null;
  typography: Typography | null = null;
  private get engine(): MathJaxRuntime {
    if (!this.mathjax) throw new Error('MathJax is not ready');
    return this.mathjax;
  }
  constructor(
    profile: DisplayOptions['font'] = 'stix2',
    numerals: DisplayOptions['numerals'] = 'oldstyle',
  ) {
    if (!Object.hasOwn(PROFILES, profile)) throw new TypeError('Unknown font profile');
    if (!Object.hasOwn(NUMERALS, numerals)) throw new TypeError('Unknown numeral style');
    this.profile = Object.freeze({
      ...Display.typography(profile, numerals),
      label: `${PROFILES[profile].label} · ${NUMERALS[numerals]}`,
    });
    // Separate contexts for each font/style keep extensions and lining-axis
    // calibration out of other fonts and native oldstyle axes. Engines are lazy
    // and cached: switching back never reloads MathJax or rebuilds digit nodes.
    this.host = document.createElement('iframe');
    this.host.className = 'math-engine-frame';
    this.host.title = `Typesetter: ${this.profile.label}`;
    this.host.tabIndex = -1;
    this.host.setAttribute('aria-hidden', 'true');
    document.body.append(this.host);
    this.staging = document.createElement('div');
    this.staging.className = 'math-staging';
    this.staging.setAttribute('aria-hidden', 'true');
    document.body.append(this.staging);
    this.boot = this.load();
    // The clock reads error/ready and keeps displaying ordinary time on failure.
    this.boot.catch((error) => {
      this.error = error;
    });
  }
  load() {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.error = error;
          reject(error);
        } else {
          this.ready = true;
          resolve();
        }
      };
      const timer = setTimeout(() => finish(new Error('MathJax loading timed out')), 20000);
      const engineWindow = this.host.contentWindow as
        | (Window & typeof globalThis & { MathJax: MathJaxRuntime })
        | null;
      const engineDocument = this.host.contentDocument;
      if (!engineWindow || !engineDocument)
        return finish(new Error('MathJax frame is unavailable'));
      const config = {
        loader: {
          load: ['[tex]/html'],
          failed: (error: unknown) =>
            finish(new Error(`MathJax: ${error instanceof Error ? error.message : String(error)}`)),
        },
        tex: { packages: { '[+]': ['html'] } },
        output: {
          font: this.profile.font,
          fontExtensions: this.profile.extensions.slice(),
          displayOverflow: 'overflow',
        },
        svg: { fontCache: 'none' },
        options: { enableMenu: false },
        startup: { typeset: false },
      };
      // MathJax uses realm-sensitive Array/Object checks in its option merger.
      // Construct configuration values in the engine's own realm.
      engineWindow.MathJax = engineWindow.JSON.parse(JSON.stringify(config));
      engineWindow.MathJax.loader.failed = (error) =>
        finish(new Error(`MathJax: ${error instanceof Error ? error.message : String(error)}`));
      const script = engineDocument.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-svg-nofont.js';
      script.async = true;
      script.id = 'mathjax-script';
      script.onerror = () => finish(new Error('MathJax could not be downloaded'));
      script.onload = () => {
        const startup = engineWindow.MathJax?.startup?.promise;
        if (!startup) return finish(new Error('MathJax startup is unavailable'));
        startup
          .then(() => {
            this.mathjax = engineWindow.MathJax;
            this.identifyGlyphs();
            return this.calibrateTypography();
          })
          .then(() => finish(), finish);
      };
      engineDocument.head.append(script);
    });
  }
  identifyGlyphs() {
    // With fontCache:none, MathJax's pathNode keeps the Unicode code but drops
    // its size variant. Capture that identity before it is lost. The isolated
    // engine owns this prototype; never patch another font's browsing context.
    const exports = this.engine._?.output?.svg?.Wrapper;
    const prototype = (exports?.SvgWrapper || exports?.SVGWrapper)?.prototype;
    if (typeof prototype?.charNode !== 'function') return; // Compatibility engines keep decorations fading.
    const original = prototype.charNode;
    const font = `${this.profile.id}@${this.engine.version}`;
    prototype.charNode = function (variant, code, path) {
      const node = original.call(this, variant, code, path);
      this.adaptor.setAttribute(node, 'data-glyph-key', `${font}:${variant}:${code}`);
      return node;
    };
  }
  async calibrateTypography() {
    // FontData.params.axis_height is MathJax's TeX math-axis parameter.
    // Calibrate ONCE from the actual font's zero, not the current time's digits.
    // Otherwise the vertical center would change whenever (say) 8 becomes 9.
    let typography: Omit<Typography, 'equalCenterY'>;
    const node = await this.engine.tex2svgPromise(mark('probe', '0', this.profile), {
      display: true,
      em: 16,
      ex: 8,
      containerWidth: 100000,
    });
    this.staging.append(node);
    try {
      const svg = node.querySelector('svg');
      const paths = [...(svg?.querySelectorAll('#fc-probe path') || [])];
      const params = this.engine.startup?.document?.outputJax?.font?.params;
      if (!svg || !paths.length || !Number.isFinite(params?.axis_height)) {
        throw new Error('MathJax math-axis calibration is unavailable');
      }
      const inverse = svg.getScreenCTM()?.inverse();
      if (!inverse) throw new Error('MathJax calibration coordinates are unavailable');
      const { top, bottom } = pathBounds(svg.querySelector('#fc-probe'), inverse);
      // SVG's math root is y-down; the font axis is y-up, in em.
      const numericAxis = -(top + bottom) / 2000;
      if (!(numericAxis > 0.15 && numericAxis < 0.55)) {
        throw new Error('Unexpected numeral metrics during math-axis calibration');
      }
      typography = Object.freeze({
        profile: this.profile.id,
        numerals: this.profile.numerals,
        axisMode: this.profile.numericAxis ? 'numeric' : 'font',
        referenceDigit: '0',
        originalAxisEm: params.axis_height,
        numericAxisEm: numericAxis,
        zeroTop: top,
        zeroBottom: bottom,
        axisEm: params.axis_height,
      });
      // Set this before typesetting any clock frame. Fractions and symmetric
      // delimiters then use the SAME axis as the vcentered arithmetic signs.
      if (this.profile.numericAxis) params.axis_height = numericAxis;
      typography = Object.freeze({ ...typography, axisEm: params.axis_height });
    } finally {
      node.remove();
    }
    // A font's metric bounds and its visible ink can differ by a fraction of
    // a unit. Measure the centered '=' too, so time mode has exactly the same
    // baseline as equation mode, down to this optical/metric discrepancy.
    const axisNode = await this.engine.tex2svgPromise(relation(this.profile), {
      display: true,
      em: 16,
      ex: 8,
      containerWidth: 100000,
    });
    this.staging.append(axisNode);
    try {
      const svg = axisNode.querySelector('svg');
      if (!svg) throw new Error('Equal-sign calibration failed');
      const inverse = svg.getScreenCTM()?.inverse();
      if (!inverse) throw new Error('Equal-sign calibration coordinates are unavailable');
      const equal = pathBounds(svg.querySelector('#fc-eq'), inverse);
      this.typography = Object.freeze({ ...typography, equalCenterY: equal.centerY });
    } finally {
      axisNode.remove();
    }
  }
  frame(
    ast: Expr | null,
    code: string,
    seconds: number,
    settings: Partial<TexOptions> = {},
  ): Promise<Frame> {
    const tex = frameTex(ast, code, seconds, {
      ...settings,
      oldstyle: this.profile.oldstyle,
      centerOperators: this.profile.centerOperators,
    });
    if (this.cache.has(tex)) {
      const hit = this.cache.get(tex)!;
      this.cache.delete(tex);
      this.cache.set(tex, hit);
      return hit;
    }
    const task = this.tail
      .then(() => this.boot)
      .then(() => this.convert(tex, code, seconds, false, settings.division));
    // A failed conversion must not poison subsequent frames.
    this.tail = task.catch(() => {});
    this.cache.set(tex, task);
    task.catch(() => {
      if (this.cache.get(tex) === task) this.cache.delete(tex);
    });
    while (this.cache.size > 180) this.cache.delete(this.cache.keys().next().value!);
    return task;
  }
  // The small clock uses a fixed set of glyphs from this same font engine.
  // Prepare all ten digits and the colon once, rather than typesetting it every second.
  clockFace(): Promise<ClockFace> {
    if (!this.clockFaceTask) {
      const task = this.tail
        .then(() => this.boot)
        .then(async () => {
          const glyphs: Record<string, GlyphToken> = {};
          for (const [code, seconds] of [
            ['0123', 45],
            ['1607', 58],
            ['0900', 0],
          ] as const) {
            const tex = frameTex(null, code, seconds, this.profile);
            const frame = await this.convert(tex, code, seconds, true);
            for (const token of frame.tokens) glyphs[token.text] = token;
            glyphs[':'] = frame.colons[0];
          }
          if (!glyphs[':'] || Object.keys(glyphs).length !== 11)
            throw new Error('Incomplete clock font');
          // Some proportional oldstyle zeros (notably Fira) exceed a 500-unit
          // clock cell. Fit the entire face uniformly, retaining fixed centers
          // and identical sizes for hours, minutes, seconds and colons.
          const scale = Math.min(
            1,
            480 / Math.max(...'0123456789'.split('').map((n) => glyphs[n].bounds.w)),
          );
          return Object.freeze({
            font: this.profile.id,
            numerals: this.profile.numerals,
            scale,
            glyphs: Object.freeze(glyphs),
          });
        });
      this.clockFaceTask = task;
      this.tail = task.catch(() => {});
    }
    return this.clockFaceTask;
  }
  private async convert(
    tex: string,
    code: string,
    seconds: number,
    clockFace = false,
    division: TexOptions['division'] = 'fraction',
  ): Promise<Frame> {
    const node = await this.engine.tex2svgPromise(tex, {
      display: true,
      em: 16,
      ex: 8,
      containerWidth: 100000,
    });
    const svg = node.querySelector('svg');
    if (!svg || svg.querySelector('[data-mml-node="merror"]'))
      throw new Error('TeX typesetting failed');
    // Not display:none: the SVG must participate in layout for getScreenCTM().
    this.staging.append(node);
    try {
      const v = svg.viewBox.baseVal;
      if (!(v.width > 0 && v.height > 0)) throw new Error('Empty SVG layout');
      const viewBox = { x: v.x, y: v.y, w: v.width, h: v.height };
      // getCTM() on an outer <svg> and on a child need not target the same
      // viewport. In particular the off-screen staging offset must cancel.
      // getScreenCTM() gives BOTH matrices in document-viewport coordinates.
      const rootCTM = svg.getScreenCTM();
      if (!rootCTM) throw new Error('SVG measurement is unavailable');
      const inverse = rootCTM.inverse();
      const secondsText = String(seconds).padStart(2, '0');
      const equality = svg.querySelector('#fc-eq');
      const slots = ['d0', 'd1', 'd2', 'd3', 's0', 's1'];
      if (equality) slots.push('eq');
      const symbolMarks = new Map(
        [...svg.querySelectorAll('[id^="fc-op-"]')].map((el) => {
          const [, role, attachment, ordinal] = el.id.match(
            /^fc-op-\d+-(add|sub|neg|mul|div|fact)-(b[1-3]|u[0-3][1-4])-(\d+)$/,
          )!;
          const kinds: Record<string, string> = {
            add: '+',
            sub: '−',
            neg: '−',
            mul: '×',
            div: division === 'slash' ? '/' : '÷',
            fact: '!',
          };
          const kind = kinds[role];
          return [el.id.slice(3), { kind, role, site: `${role}-${attachment}-${ordinal}` }];
        }),
      );
      const symbolOffset = slots.length;
      slots.push(...symbolMarks.keys());
      function glyphToken(
        paths: SVGPathElement[],
        metadata: Omit<PlacedToken, 'matrix' | 'shape'>,
      ): GlyphToken {
        const { slot } = metadata;
        if (!paths.length) throw new Error(`Missing glyph ${slot}`);
        if (paths.some((path) => !path.getAttribute('d')?.trim())) {
          throw new Error(`Empty glyph path ${slot}`);
        }
        const ctm = paths[0].getScreenCTM();
        if (!ctm) throw new Error(`Missing transform ${slot}`);
        // cssId may insert an id-alignment box whose origin changes by context.
        // Anchor to the actual glyph path, not to that wrapper. This keeps the
        // same numeral's natural coordinates stable in a root, fraction or power.
        const local = inverse.multiply(ctm);
        if (!finiteMatrix(local)) throw new Error('Non-finite glyph coordinates');
        const shape = document.createElementNS(NS, 'g');
        const glyphInverse = ctm.inverse();
        const corners = [];
        for (const path of paths) {
          const copy = path.cloneNode(true) as SVGPathElement;
          copy.removeAttribute('id');
          copy.removeAttribute('transform');
          copy.removeAttribute('data-fc-extract');
          const pathCTM = path.getScreenCTM();
          if (!pathCTM) throw new Error(`Missing path transform ${slot}`);
          const relative = glyphInverse.multiply(pathCTM);
          const placed = local.multiply(relative);
          if (!finiteMatrix(placed)) throw new Error(`Invalid path transform ${slot}`);
          const box = path.getBBox();
          for (const [x, y] of [
            [box.x, box.y],
            [box.x + box.width, box.y],
            [box.x, box.y + box.height],
            [box.x + box.width, box.y + box.height],
          ])
            corners.push(new DOMPoint(x, y).matrixTransform(placed));
          const values = matrixArray(relative).map((v) =>
            Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(7)),
          );
          if (values.join(',') !== '1,0,0,1,0,0')
            copy.setAttribute('transform', `matrix(${values.join(' ')})`);
          shape.append(copy);
        }
        // Validate the geometry we will actually display, not just the
        // original SVG. A finite matrix can still put a glyph far off-screen.
        const minX = Math.min(...corners.map((p) => p.x));
        const maxX = Math.max(...corners.map((p) => p.x));
        const minY = Math.min(...corners.map((p) => p.y));
        const maxY = Math.max(...corners.map((p) => p.y));
        const slack = 100; // 0.1 em allows ordinary glyph overhangs.
        if (
          !(maxX > minX && maxY > minY) ||
          maxX < v.x - slack ||
          minX > v.x + v.width + slack ||
          maxY < v.y - slack ||
          minY > v.y + v.height + slack
        ) {
          throw new Error(`Glyph outside SVG viewBox ${slot}`);
        }
        const center = new DOMPoint((minX + maxX) / 2, (minY + maxY) / 2).matrixTransform(
          new DOMMatrix(matrixArray(local)).inverse(),
        );
        return {
          ...metadata,
          matrix: matrixArray(local),
          shape,
          inkCenter: [center.x, center.y],
          bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        };
      }
      const tokens = slots.map((slot, i) => {
        const symbol = symbolMarks.get(slot);
        return glyphToken([...svg.querySelectorAll<SVGPathElement>(`#fc-${slot} path`)], {
          slot,
          kind: symbol?.kind || (slot === 'eq' ? '=' : 'digit'),
          text: symbol ? symbol.kind : slot === 'eq' ? '=' : i < 4 ? code[i] : secondsText[i - 4],
          font: this.profile.id,
          ...symbol,
        });
      });
      const colons = clockFace
        ? [...svg.querySelectorAll<SVGPathElement>('path[data-c="3A"]')].map((path, i) =>
            glyphToken([path], { slot: `colon${i}`, kind: ':', text: ':', font: this.profile.id }),
          )
        : [];
      const structures: PlacedToken[] = [];
      function ruleToken(
        rect: SVGRectElement,
        metadata: { site: string; kind: string; glyphKey: string },
      ): PlacedToken {
        const box = rect.getBBox(),
          ctm = rect.getScreenCTM();
        if (!ctm || !(box.width > 0 && box.height > 0))
          throw new Error('Invalid mathematical rule');
        // A unit rectangle makes width and thickness independent coordinates.
        // Its shape never changes while the six matrix components interpolate.
        const local = new DOMMatrix(matrixArray(inverse.multiply(ctm))).multiply(
          new DOMMatrix([box.width, 0, 0, box.height, box.x, box.y]),
        );
        if (!finiteMatrix(local)) throw new Error('Non-finite rule coordinates');
        const shape = document.createElementNS(NS, 'g'),
          unit = document.createElementNS(NS, 'rect');
        unit.setAttribute('width', '1');
        unit.setAttribute('height', '1');
        shape.append(unit);
        rect.setAttribute('data-fc-extract', '');
        return {
          ...metadata,
          slot: metadata.site,
          text: metadata.kind,
          matrix: matrixArray(local),
          shape,
        };
      }
      const coreOf = (tag: Element, name: string) =>
        tag.matches(`[data-mml-node="${name}"]`)
          ? tag
          : tag.querySelector(`[data-mml-node="${name}"]`);
      const ownRules = (core: Element) =>
        [...core.querySelectorAll('rect')].filter(
          (rect) => rect.closest('[data-mml-node="mfrac"],[data-mml-node="msqrt"]') === core,
        );
      const singleGlyph = (path: SVGPathElement | undefined) =>
        path?.hasAttribute('data-glyph-key') &&
        path.closest('[data-mml-node="mo"]')?.querySelectorAll('path').length === 1;
      function takeGlyph(
        path: SVGPathElement,
        metadata: { site: string; kind: string; glyphKey: string },
      ) {
        structures.push(
          glyphToken([path], { ...metadata, slot: metadata.site, text: metadata.kind }),
        );
        path.setAttribute('data-fc-extract', '');
      }
      for (const tag of svg.querySelectorAll('[id^="fc-struct-"]')) {
        const [, role, attachment, ordinal] = tag.id.match(
          /^fc-struct-(frac|root|paren)-(b[1-3]|u[0-3][1-4])-(\d+)$/,
        )!;
        const site = `${role}-${attachment}-${ordinal}`;
        if (role === 'frac') {
          const core = coreOf(tag, 'mfrac'),
            rules = core ? ownRules(core) : [];
          if (rules.length === 1)
            structures.push(ruleToken(rules[0], { kind: 'fraction-rule', site, glyphKey: 'rule' }));
        } else if (role === 'root') {
          const core = coreOf(tag, 'msqrt');
          if (!core) continue;
          const paths = [...core.querySelectorAll<SVGPathElement>('path[data-c="221A"]')].filter(
            (path) => path.closest('[data-mml-node="msqrt"]') === core,
          );
          const rules = ownRules(core),
            path = paths[0];
          // An assembled radical stays in the fading layer. For a single
          // glyph, the sign and overbar share an identity and timing so their
          // junction remains connected, including when a size variant changes.
          if (paths.length !== 1 || !singleGlyph(path) || rules.length !== 1) continue;
          const glyphKey = path.getAttribute('data-glyph-key')!;
          takeGlyph(path, { kind: 'root-sign', site, glyphKey });
          structures.push(ruleToken(rules[0], { kind: 'root-rule', site, glyphKey }));
        } else {
          const paths = [
            ...tag.querySelectorAll<SVGPathElement>('path[data-c="28"],path[data-c="29"]'),
          ].filter((path) => path.closest('[id^="fc-struct-"]') === tag);
          for (const path of paths)
            if (singleGlyph(path)) {
              const kind = path.getAttribute('data-c') === '28' ? 'paren-left' : 'paren-right';
              takeGlyph(path, { kind, site, glyphKey: path.getAttribute('data-glyph-key')! });
            }
        }
      }
      // Anchor equations by the actual equal-sign ink, not by the full SVG's
      // height. In time mode use the same mathematical axis (there is no '=').
      let axisY = this.typography!.equalCenterY;
      if (equality) axisY = pathBounds(equality, inverse).centerY;
      if (!Number.isFinite(axisY)) throw new Error('Invalid mathematical axis');
      const decorations = document.createElementNS(NS, 'g');
      decorations.setAttribute('fill', 'currentColor');
      decorations.setAttribute('stroke', 'currentColor');
      decorations.setAttribute('stroke-width', '0');
      for (const child of svg.children) decorations.append(child.cloneNode(true));
      for (const slot of slots) decorations.querySelector(`#fc-${slot}`)?.remove();
      decorations.querySelectorAll('[data-fc-extract]').forEach((el) => el.remove());
      // cssId is only a temporary typesetting marker, never an on-screen id.
      decorations.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      return {
        tex,
        viewBox,
        tokens: tokens.slice(0, 6),
        colons,
        equality: equality ? tokens[6] : null,
        symbols: [...tokens.slice(symbolOffset), ...structures],
        decorations,
        axisY,
        typography: this.typography!,
        font: this.profile.id,
        numerals: this.profile.numerals,
      };
    } finally {
      node.remove();
    }
  }
}
const api = { Typesetter, PROFILES, NUMERALS, expressionTex, frameTex };
export { Typesetter, PROFILES, NUMERALS };
export default Object.freeze(api);
