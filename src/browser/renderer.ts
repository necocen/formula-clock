import type {
  ClockLayout,
  DisplayOptions,
  Expr,
  GlyphDiagnostic,
  LayoutItem,
  SharedSnapshot,
} from '../shared/types.ts';
import FormulaDisplay from '../shared/display.ts';
import FormulaExpression from '../shared/expression.ts';
import FormulaSymbols from '../shared/symbols.ts';
import type { Typesetter } from './typesetter.ts';
import { $, pad } from './dom.ts';
import type { ClockFace, DisplayedFrame, Frame, PlacedToken, Translate } from './types.ts';
import type { FrameCommit } from './sharing.ts';

interface Movement {
  from: number[];
  to: number[];
  started: number;
}
type MovingElement = SVGGElement & { _shapeKey?: string };
interface MorphState {
  angle: number;
  weights: Record<string, number>;
  center: number[];
}
interface MorphPart {
  group: SVGGElement;
  shape: Node;
  center: number[];
}
interface Morph {
  parts: Record<string, MorphPart>;
  from: MorphState;
  to: { angle: number; center: number[] };
  started: number;
  target: string;
}
interface SymbolRecord {
  el: MovingElement;
  token: PlacedToken;
  exiting?: boolean;
  animation?: Animation | null;
}

export interface RendererDeps {
  t: Translate;
  stage: HTMLElement;
  sourceTime: HTMLElement;
  shareButton: HTMLButtonElement;
  reducedMotion: MediaQueryList;
  engine(): Typesetter;
  view(): DisplayOptions;
  face(font: DisplayOptions['font'], numerals: DisplayOptions['numerals']): ClockFace | undefined;
  snapshotAt(code: string, seconds: number): SharedSnapshot | null;
  onFrameCommitted(commit: FrameCommit): void;
  prepare(): void;
}

export interface Renderer {
  render(
    ast: Expr | null,
    code: string,
    seconds: number,
    loading: boolean,
    instant?: boolean,
  ): void;
  applyFrame(
    frame: Frame,
    ast: Expr | null,
    code: string,
    seconds: number,
    loading: boolean,
    instant: boolean,
    view: DisplayOptions,
  ): void;
  invalidate(): void;
  cancelPending(): void;
  finishAnimations(): void;
  setEngineError(message: string | null): void;
  readonly engineError: string | null;
  readonly displayed: DisplayedFrame | null;
  readonly layout: ClockLayout | null;
  digits(): SVGGElement[];
  glyphDiagnostics(): GlyphDiagnostic[];
}

// MathJax computes the layout; persistent digits and equality display it.
// The four HHMM objects are never recreated, including ordinary clock mode.
export function createRenderer(deps: RendererDeps): Renderer {
  const { t, stage, sourceTime, shareButton, reducedMotion } = deps;
  const digitsEls = [...stage.querySelectorAll<MovingElement>('.digit')];
  const sourceEls = [...sourceTime.querySelectorAll<MovingElement>('.source-digit')];
  const sourceColons = [...sourceTime.querySelectorAll<MovingElement>('.colon')];
  const scene = $<SVGSVGElement>('#math-scene'),
    notationRoot = $<MovingElement>('#notation-root'),
    equalSign = $<MovingElement>('#equal-sign');
  const operatorRoot = $<MovingElement>('#operator-root'),
    symbolRecords = new Set<SymbolRecord>();
  const secondsEls = [...scene.querySelectorAll<MovingElement>('.answer-digit')];
  const movingEls = [...digitsEls, ...secondsEls];
  const plainTime = $('#plain-time');
  const movement = new Map<MovingElement, Movement>();
  const morphs = new Map<MovingElement, Morph>();
  let notation: SVGGElement | null = null,
    lastVisual = '',
    firstFrame = true;
  let latestLayout: ClockLayout | null = null,
    displayedFrame: DisplayedFrame | null = null;
  let requestSerial = 0,
    animationId = 0,
    preparationId = 0;
  let engineError: string | null = null;
  const reportedRenderErrors = new Set<string>();
  const mathNS = 'http://www.w3.org/2000/svg';
  const DURATION = 680;
  const MORPH_DURATION = 320;
  const matrixString = (a: number[]) => `matrix(${a.map((n) => n.toFixed(7)).join(' ')})`;
  const ease = (t: number) => 1 - Math.pow(1 - t, 4);
  function matrixAt(record: Movement, now: number) {
    const p = Math.min(1, Math.max(0, (now - record.started) / DURATION));
    const k = ease(p);
    return record.to.map((v, i) => record.from[i] + (v - record.from[i]) * k);
  }
  function animatePositions(now: number) {
    let active = false;
    for (const [el, record] of movement) {
      const matrix = matrixAt(record, now);
      el.setAttribute('transform', matrixString(matrix));
      if (now - record.started < DURATION) active = true;
    }
    for (const [el, record] of morphs) {
      paintMorph(record, now);
      if (now - record.started < MORPH_DURATION) active = true;
      else finishMorph(el);
    }
    animationId = active ? requestAnimationFrame(animatePositions) : 0;
  }
  function setPosition(el: MovingElement, target: number[], animated: boolean, now: number) {
    const old = movement.get(el);
    const from = old ? matrixAt(old, now) : target;
    movement.set(el, {
      from: animated ? from : target,
      to: target,
      started: animated ? now : now - DURATION,
    });
    el.setAttribute('transform', matrixString(animated ? from : target));
    if (animated && !animationId) animationId = requestAnimationFrame(animatePositions);
  }
  function fadeIn(el: Element, duration: number, delayed = false) {
    if (reducedMotion.matches) return;
    el.animate(
      delayed
        ? [{ opacity: 0 }, { opacity: 0, offset: 0.18 }, { opacity: 1 }]
        : [{ opacity: 0.15 }, { opacity: 1 }],
      { duration, easing: 'ease-out' },
    );
  }
  function morphStateAt(record: Morph, now: number): MorphState {
    const p = Math.min(1, Math.max(0, (now - record.started) / MORPH_DURATION));
    const k = p * p * (3 - 2 * p),
      mix = (a: number, b: number) => a + (b - a) * k;
    return {
      angle: mix(record.from.angle, record.to.angle),
      weights: Object.fromEntries(
        Object.keys(record.parts).map((kind) => [
          kind,
          mix(record.from.weights[kind] || 0, kind === record.target ? 1 : 0),
        ]),
      ),
      center: record.from.center.map((v, i) => mix(v, record.to.center[i])),
    };
  }
  function paintMorph(record: Morph, now: number) {
    const state = morphStateAt(record, now);
    for (const [kind, part] of Object.entries(record.parts)) {
      const angle = state.angle - (kind === '×' ? 45 : 0);
      part.group.setAttribute(
        'transform',
        `translate(${state.center.join(' ')}) rotate(${angle}) translate(${-part.center[0]} ${-part.center[1]})`,
      );
      part.group.setAttribute('opacity', String(state.weights[kind]));
    }
    return state;
  }
  function finishMorph(el: MovingElement) {
    const record = morphs.get(el);
    if (!record) return;
    el.replaceChildren(record.parts[record.target].shape);
    el.removeAttribute('data-morphing');
    morphs.delete(el);
  }
  function startMorph(el: MovingElement, oldToken: PlacedToken, token: PlacedToken, now: number) {
    if (!oldToken.inkCenter || !token.inkCenter) return;
    const existing = morphs.get(el);
    const from = existing
      ? paintMorph(existing, now)
      : {
          angle: oldToken.kind === '×' ? 45 : 0,
          weights: { [oldToken.kind]: 1 },
          center: oldToken.inkCenter,
        };
    el.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    const parts = existing?.parts || {};
    for (const glyph of [oldToken, token]) {
      if (parts[glyph.kind]) continue;
      const group = document.createElementNS(mathNS, 'g'),
        shape = glyph.shape.cloneNode(true);
      group.dataset.morphGlyph = glyph.kind;
      group.append(shape);
      parts[glyph.kind] = { group, shape, center: glyph.inkCenter! };
    }
    // Preserve every visible contribution when interrupted by a third sign.
    // One layer per arithmetic glyph bounds even rapid switching to four;
    // completion restores the exact native destination glyph.
    const record = {
      parts,
      from,
      to: { angle: token.kind === '×' ? 45 : 0, center: token.inkCenter },
      started: now,
      target: token.kind,
    };
    el.replaceChildren(...Object.values(parts).map((part) => part.group));
    el.dataset.morphing = 'true';
    el.dataset.value = token.text;
    el._shapeKey = token.shape.innerHTML;
    morphs.set(el, record);
    paintMorph(record, now);
  }
  function updateSymbols(
    tokens: PlacedToken[],
    animated: boolean,
    placeToken: (token: PlacedToken, el: MovingElement, morphFrom: PlacedToken | null) => void,
    morphEnabled: boolean,
  ) {
    const previous = [...symbolRecords];
    const old = previous.map((record) => ({ ...record.token, exiting: record.exiting }));
    const matches = FormulaSymbols.match(old, tokens, { morph: animated && morphEnabled }),
      used = new Set();
    tokens.forEach((token, i) => {
      let record = previous[matches[i]];
      if (!record) {
        const el = document.createElementNS(mathNS, 'g');
        el.classList.add('moving-symbol');
        operatorRoot.append(el);
        record = { el, token };
        symbolRecords.add(record);
      } else if (record.animation) {
        const opacity = getComputedStyle(record.el).opacity;
        record.animation.cancel();
        record.animation = null;
        if (animated) record.el.animate([{ opacity }, { opacity: 1 }], { duration: 180 });
      }
      const oldToken = record.token;
      used.add(record);
      record.exiting = false;
      record.token = token;
      record.el.dataset.kind = token.kind;
      record.el.dataset.site = token.site || '';
      record.el.dataset.glyphKey = token.glyphKey || '';
      placeToken(
        token,
        record.el,
        oldToken && FormulaSymbols.morphPair(oldToken, token) ? oldToken : null,
      );
    });
    for (const record of previous)
      if (!used.has(record)) {
        const remove = () => {
          record.el.remove();
          movement.delete(record.el);
          morphs.delete(record.el);
          symbolRecords.delete(record);
        };
        if (!animated) {
          record.animation?.cancel();
          remove();
          continue;
        }
        if (record.exiting) continue;
        record.exiting = true;
        const animation = record.el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 180,
          fill: 'forwards',
        });
        record.animation = animation;
        animation.onfinish = () => {
          if (record.animation === animation && record.exiting) remove();
        };
      }
  }
  function renderStatus(message = '') {
    const status = $('#render-status');
    status.textContent = message;
    status.hidden = !message;
  }
  function plainFallback(code: string, seconds: number, reason: string) {
    shareButton.disabled = true;
    const full = `${code.slice(0, 2)}:${code.slice(2)}:${pad(seconds)}`;
    [...plainTime.querySelectorAll('span')].forEach((el, i) => {
      el.textContent = full[i];
    });
    plainTime.hidden = false;
    scene.style.visibility = 'hidden';
    sourceTime.hidden = true;
    stage.classList.add('resting');
    stage.setAttribute('aria-label', full);
    renderStatus(reason);
  }
  function renderSourceTime(
    font: DisplayOptions['font'],
    numerals: DisplayOptions['numerals'],
    code: string,
    seconds: number,
    visible: boolean,
  ) {
    const face = deps.face(font, numerals);
    if (face) {
      const colon = face.glyphs[':'];
      // Six equal 500-unit cells keep every digit stationary, even with oldstyle
      // or proportional glyphs. Fixed 450-unit separators match ordinary clock spacing.
      const centers = [400, 900, 1850, 2350, 3300, 3800];
      const baseline = 550 - (colon.bounds.y + colon.bounds.h / 2) * face.scale;
      const place = (el: MovingElement, text: string, center: number) => {
        const token = face.glyphs[text];
        if (
          el.dataset.font === font &&
          el.dataset.numerals === numerals &&
          el.dataset.value === text
        )
          return;
        const matrix = token.matrix.map((value) => value * face.scale);
        matrix[4] += center - (token.bounds.x + token.bounds.w / 2) * face.scale;
        matrix[5] += baseline;
        el.replaceChildren(token.shape.cloneNode(true));
        el.setAttribute('transform', matrixString(matrix));
        el.dataset.font = font;
        el.dataset.numerals = numerals;
        el.dataset.value = text;
      };
      const text = code + pad(seconds);
      sourceEls.forEach((el, i) => place(el, text[i], centers[i]));
      sourceColons.forEach((el, i) => place(el, ':', 1375 + i * 1450));
      sourceTime.dataset.font = font;
      sourceTime.dataset.numerals = numerals;
    }
    sourceTime.hidden = !visible || !face;
  }
  function applyFrame(
    frame: Frame,
    ast: Expr | null,
    code: string,
    seconds: number,
    loading: boolean,
    instant: boolean,
    view: DisplayOptions,
  ) {
    const W = stage.clientWidth,
      H = stage.clientHeight,
      b = frame.viewBox;
    // Fit each side of a fixed axis independently. A tall numerator may shrink
    // the equation, but must never push the equal sign or normal digits down.
    const maxFontSize = document.body.classList.contains('fullscreen')
      ? Math.min(160, H * 0.7)
      : 112;
    const { axis, scale, x, y } = FormulaDisplay.fitFrame(b, frame.axisY, W, H, maxFontSize);
    const fit = new DOMMatrix([scale, 0, 0, scale, x, y]);
    const animated = !instant && !firstFrame && !reducedMotion.matches;
    // One clock for the entire frame keeps a radical and its rule joined, even
    // if DOM work between their updates takes a few milliseconds.
    const positionTime = performance.now();
    const items: LayoutItem[] = [];
    function placeToken(
      token: PlacedToken,
      el: MovingElement,
      morphFrom: PlacedToken | null = null,
    ) {
      if (morphFrom && animated && view.symbolMorph) startMorph(el, morphFrom, token, positionTime);
      else if (
        !animated ||
        !view.symbolMorph ||
        el._shapeKey !== token.shape.innerHTML ||
        el.dataset.value !== token.text
      )
        finishMorph(el);
      // A preference change may interrupt an existing fade on a reused glyph.
      if (!animated) el.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      // Preserve the glyph's child nodes too until this clock position changes digit.
      if (
        el.dataset.value !== token.text ||
        !el.firstChild ||
        el._shapeKey !== token.shape.innerHTML
      ) {
        el.replaceChildren(token.shape.cloneNode(true));
        if (animated) fadeIn(el.firstElementChild!, 350);
        el.dataset.value = token.text;
        el._shapeKey = token.shape.innerHTML;
      }
      const m = fit.multiply(new DOMMatrix(token.matrix));
      const target = [m.a, m.b, m.c, m.d, m.e, m.f];
      setPosition(el, target, animated, positionTime);
      return {
        slot: token.slot,
        text: token.text,
        matrix: target,
        localMatrix: token.matrix.slice(),
        scale: Math.hypot(token.matrix[0], token.matrix[1]),
      };
    }
    frame.tokens.forEach((token, i) => items.push(placeToken(token, movingEls[i])));
    // Equality keeps its glyph and interpolates with the digits; other signs fade.
    if (frame.equality) placeToken(frame.equality, equalSign);
    equalSign.style.opacity = frame.equality ? '1' : '0';
    updateSymbols(frame.symbols, animated, placeToken, view.symbolMorph);
    const layer = document.createElementNS(mathNS, 'g');
    layer.classList.add('notation-layer');
    const content = frame.decorations.cloneNode(true) as SVGGElement;
    content.setAttribute('transform', matrixString([scale, 0, 0, scale, x, y]));
    layer.append(content);
    notationRoot.append(layer);
    if (notation) {
      const old = notation;
      if (animated) {
        // Finish any half-completed fade-in before starting a fade-out.
        const opacity = getComputedStyle(old).opacity;
        old.getAnimations().forEach((a) => a.cancel());
        const a = old.animate([{ opacity }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
        a.onfinish = () => old.remove();
      } else old.remove();
    }
    if (animated) fadeIn(layer, 590, true);
    notation = layer;
    stage.classList.toggle('resting', !ast);
    stage.classList.toggle('loading', loading);
    plainTime.hidden = true;
    scene.style.visibility = 'visible';
    renderSourceTime(frame.font, frame.numerals, code, seconds, !!ast && !loading);
    renderStatus();
    const time = t('clockTime', { hours: code.slice(0, 2), minutes: code.slice(2), seconds });
    stage.setAttribute(
      'aria-label',
      ast
        ? t('clockEquation', { time, expression: FormulaExpression.plain(ast, code), seconds })
        : time,
    );
    latestLayout = {
      display: { ...view },
      ast,
      code,
      seconds,
      mode: ast ? 'formula' : 'time',
      tex: frame.tex,
      items,
      width: b.w * scale,
      height: b.h * scale,
      viewBox: { ...b },
      fontSize: scale * 1000,
      axisY: axis,
      localAxisY: frame.axisY,
      fit: [scale, 0, 0, scale, x, y],
      typography: frame.typography,
    };
    displayedFrame = { frame, ast, code, seconds, view };
    deps.onFrameCommitted({ code, seconds, loading, view, ast });
    firstFrame = false;
    // Let the current frame reach a rendering opportunity before preparing
    // the small clock and upcoming seconds, including after a font change.
    cancelAnimationFrame(preparationId);
    if (!loading) {
      const serial = requestSerial;
      preparationId = requestAnimationFrame(() => {
        preparationId = requestAnimationFrame(() => {
          if (serial === requestSerial && !document.hidden) deps.prepare();
        });
      });
    }
  }
  function renderExpression(
    ast: Expr | null,
    code: string,
    seconds: number,
    loading: boolean,
    instant = false,
  ) {
    const snapshot = deps.snapshotAt(code, seconds);
    if (snapshot) {
      ast = snapshot.ast;
      loading = false;
    }
    if (loading) shareButton.disabled = true;
    const engine = deps.engine(),
      view = deps.view();
    const key = `${view.font}:${view.numerals}:${view.division}:${view.symbolMotion}:${view.structureMotion}:${view.symbolMorph}:${JSON.stringify(ast)}:${code}:${seconds}:${stage.clientWidth}:${stage.clientHeight}:${loading}`;
    if (lastVisual === key && !instant) return;
    lastVisual = key;
    const serial = ++requestSerial;
    const isCurrent = () => serial === requestSerial;
    if (!engine.ready)
      plainFallback(code, seconds, t(engine.error ? 'typesettingFailed' : 'preparing'));
    if (engine.error) return;
    engine
      .frame(ast, code, seconds, view, isCurrent)
      .then((frame) => {
        if (serial !== requestSerial) return; // Discard any stale async result.
        engineError = null;
        applyFrame(frame, ast, code, seconds, loading, instant, view);
      })
      .catch(async (error) => {
        if (serial !== requestSerial) return;
        engineError = String(error);
        if (!reportedRenderErrors.has(engineError)) {
          reportedRenderErrors.add(engineError);
          console.warn('[Formula Clock] SVG rendering failed; showing ordinary time.', error);
        }
        // Never let a typesetting/network failure freeze the clock.
        if (ast && engine.ready) {
          try {
            const clockFrame = await engine.frame(null, code, seconds, view, isCurrent);
            if (serial !== requestSerial) return;
            applyFrame(clockFrame, null, code, seconds, false, instant, view);
            renderStatus(t('formulaFailed'));
            return;
          } catch {
            /* Ordinary text fallback below. */
          }
        }
        plainFallback(code, seconds, t('typesettingFailed'));
      });
  }
  return {
    render: renderExpression,
    applyFrame,
    invalidate() {
      lastVisual = '';
    },
    cancelPending() {
      ++requestSerial;
    },
    finishAnimations() {
      scene.getAnimations({ subtree: true }).forEach((animation) => animation.finish());
    },
    setEngineError(message) {
      engineError = message;
    },
    get engineError() {
      return engineError;
    },
    get displayed() {
      return displayedFrame;
    },
    get layout() {
      return latestLayout;
    },
    digits: () => [...digitsEls],
    glyphDiagnostics() {
      const host = stage.getBoundingClientRect();
      return movingEls.map((el) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return {
          text: el.dataset.value,
          transform: el.getAttribute('transform'),
          x: r.x - host.x,
          y: r.y - host.y,
          width: r.width,
          height: r.height,
          inStage:
            r.width > 0 &&
            r.height > 0 &&
            r.right > host.left &&
            r.left < host.right &&
            r.bottom > host.top &&
            r.top < host.bottom,
          opacity: s.opacity,
          visibility: s.visibility,
        };
      });
    },
  };
}
