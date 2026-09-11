import {
  type DisplayOptions,
  type FormulaProvider,
  type Expr,
  type LayoutItem,
  type ClockLayout,
} from '../shared/types.ts';
import FormulaI18n from '../shared/i18n.ts';
import FormulaDisplay from '../shared/display.ts';
import FormulaShare from '../shared/share.ts';
import FormulaExpression from '../shared/expression.ts';
import FormulaSymbols from '../shared/symbols.ts';
import { $, pad, timeCode, setupDialog } from './dom.ts';
import { createTimeSignal } from './audio.ts';
import { assertProvider, createDataSource } from './data-source.ts';
import { createSettings } from './settings.ts';
import { createFullscreen } from './fullscreen.ts';
import { createSharing, readInitialShare } from './sharing.ts';
import type { DisplayedFrame, Frame, PlacedToken } from './types.ts';
// The default provider registers itself on FORMULA_CLOCK_CONFIG before the app reads it.
import './provider.ts';

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
interface Preview {
  epoch: number;
  started: number;
  paused: boolean;
}
/* Formula Clock: persistent digit objects, separate typography and data delivery. */
(() => {
  'use strict';
  const ui = FormulaI18n.create(navigator.languages?.[0] || navigator.language),
    t = ui.t;
  ui.apply(document);
  const stage = $('#stage'),
    digitsEls = [...stage.querySelectorAll<MovingElement>('.digit')];
  const sourceTime = $('#source-time'),
    sourceEls = [...sourceTime.querySelectorAll<MovingElement>('.source-digit')];
  const sourceColons = [...sourceTime.querySelectorAll<MovingElement>('.colon')];
  const settingsDialog = $<HTMLDialogElement>('#settings'),
    settingsButton = $<HTMLButtonElement>('#settings-open');
  const licenseDialog = $<HTMLDialogElement>('#licenses');
  const shareButton = $<HTMLButtonElement>('#share'),
    shareDialog = $<HTMLDialogElement>('#share-dialog');
  const { view: sharedView, state: sharedState } = readInitialShare();
  setupDialog(settingsDialog, settingsButton, $<HTMLButtonElement>('#settings-close'));
  setupDialog(
    licenseDialog,
    $<HTMLButtonElement>('#licenses-open'),
    $<HTMLButtonElement>('#licenses-close'),
  );
  setupDialog(shareDialog, shareButton, $<HTMLButtonElement>('#share-close'), false);
  shareButton.hidden = !['http:', 'https:'].includes(location.protocol);
  const data = createDataSource({
    isCurrentCode: (code) => timeCode(getNow()) === code,
    kick: () => refresh(true),
  });
  if (sharedState) document.title = FormulaShare.title(sharedState);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const b = document.createElement('button');
    b.className = 'tick' + (i % 5 === 0 ? ' major' : '');
    b.setAttribute('aria-label', t('previewSecond', { seconds: i }));
    b.addEventListener('click', () => {
      const d = getNow();
      d.setSeconds(i, 0);
      setPreview(d, true);
    });
    $('#ruler').append(b);
    return b;
  });
  function setDataProvider(next: FormulaProvider) {
    assertProvider(next);
    sharing.leaveSharedView();
    data.replaceProvider(next);
    lastVisual = '';
    lastCode = null;
    ++requestSerial;
    refresh(true);
  }

  const settings = createSettings({
    settingsDialog,
    shareButton,
    sharedState,
    leaveShared: (keepFormula) => sharing.leaveSharedView(keepFormula),
    invalidate: () => {
      lastVisual = '';
    },
    kick: () => refresh(true),
    setEngineError: (message) => {
      engineError = message;
    },
  });
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
    animationId = 0;
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
    const face = settings.face(font, numerals);
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
    sharing.frameCommitted({ code, seconds, loading, view, ast });
    firstFrame = false;
  }
  function renderExpression(
    ast: Expr | null,
    code: string,
    seconds: number,
    loading: boolean,
    instant = false,
  ) {
    const snapshot = sharing.snapshotAt(code, seconds);
    if (snapshot) {
      ast = snapshot.ast;
      loading = false;
    }
    if (loading) shareButton.disabled = true;
    const engine = settings.engine(),
      view = settings.view();
    const key = `${view.font}:${view.numerals}:${view.division}:${view.symbolMotion}:${view.structureMotion}:${view.symbolMorph}:${JSON.stringify(ast)}:${code}:${seconds}:${stage.clientWidth}:${stage.clientHeight}:${loading}`;
    if (lastVisual === key && !instant) return;
    lastVisual = key;
    const serial = ++requestSerial;
    if (!engine.ready)
      plainFallback(code, seconds, t(engine.error ? 'typesettingFailed' : 'preparing'));
    if (engine.error) return;
    engine
      .frame(ast, code, seconds, view)
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
            const clockFrame = await engine.frame(null, code, seconds, view);
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
  // Warm only the immediately upcoming frames; do not queue a minute of work
  // ahead of interactive previews. The LRU retains recent typesetting results.
  function prepareNext(now: Date) {
    if (!settings.engine().ready || preview?.paused || document.hidden) return;
    for (const offset of [1, 2]) {
      const next = new Date(+now + offset * 1000),
        code = timeCode(next),
        result = data.getMinute(code);
      if (result)
        settings
          .engine()
          .frame(
            result.solutions[next.getSeconds()] || null,
            code,
            next.getSeconds(),
            settings.view(),
          )
          .catch(() => {});
    }
  }
  // Transport time is anchored to the wall clock (live) or a monotonic clock (preview).
  let preview: Preview | null = sharedState
    ? { epoch: +FormulaShare.localDate(sharedState.t), started: performance.now(), paused: true }
    : null;
  let generation = 0,
    lastSecond: number | null = null,
    lastCode: string | null = null;
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let nextPrefetch: { code: string; at: number } | null = null;
  function getNow() {
    return preview
      ? new Date(preview.epoch + (preview.paused ? 0 : performance.now() - preview.started))
      : new Date();
  }
  function setPreview(date: Date, paused = true) {
    if (!(date instanceof Date) || !Number.isFinite(+date)) return;
    sharing.leaveSharedView();
    preview = { epoch: +date, started: performance.now(), paused };
    resetTransport();
  }
  function resetTransport() {
    generation++;
    lastSecond = null;
    sound.cancel();
    document.body.classList.toggle('preview-mode', !!preview);
    $('#transport').hidden = !preview;
    refresh(true);
    scheduleTick();
  }
  function goLive() {
    sharing.leaveSharedView();
    preview = null;
    resetTransport();
  }
  function pauseClock() {
    if (preview?.paused) return;
    // Freeze the second actually on screen, even if the next frame is pending.
    const now = getNow();
    if (displayedFrame) {
      const { code, seconds } = displayedFrame;
      now.setHours(Number(code.slice(0, 2)), Number(code.slice(2)), seconds, 0);
    }
    setPreview(now, true);
  }
  function stepSecond(offset: -1 | 1) {
    if (!preview?.paused) return;
    // Advance the requested time, so rapid keys accumulate before rendering.
    setPreview(new Date(Math.floor(+getNow() / 1000) * 1000 + offset * 1000), true);
  }
  const sharing = createSharing({
    t,
    shareButton,
    shareDialog,
    sharedView,
    initiallyShared: !!sharedState,
    displayedFrame: () => displayedFrame,
    applyFrame: (frame, ast, code, seconds, loading, instant, view) =>
      applyFrame(frame, ast, code, seconds, loading, instant, view),
    invalidate: () => {
      lastVisual = '';
    },
    cancelPending: () => {
      ++requestSerial;
    },
    finishAnimations: () => {
      scene.getAnimations({ subtree: true }).forEach((animation) => animation.finish());
    },
    engineError: () => engineError,
    hasMinute: (code) => data.hasMinute(code),
    getMinute: (code) => data.getMinute(code),
    settle: (epoch) => {
      preview = { epoch, started: performance.now(), paused: true };
      resetTransport();
    },
    previewPaused: () => !!preview?.paused,
    kick: () => refresh(true),
    adoptView: (view) => settings.adoptView(view),
  });
  function refresh(force = false) {
    const now = getNow(),
      secondKey = Math.floor(+now / 1000),
      seconds = now.getSeconds(),
      code = timeCode(now);
    const changed = secondKey !== lastSecond;
    if (!changed && !force) return;
    const previousSecond = lastSecond;
    lastSecond = secondKey;
    const result = data.getMinute(code);
    data.request(code);
    // Spread live hour-boundary prefetches across the first 30 seconds of :59.
    // Use clock ticks instead of a timer so skipped minutes cannot leave stale work.
    if (code !== lastCode) {
      lastCode = code;
      const next = new Date(+now);
      next.setMinutes(next.getMinutes() + 1, 0, 0);
      const minuteStart = +now - seconds * 1000 - now.getMilliseconds();
      nextPrefetch = {
        code: timeCode(next),
        at: minuteStart + (!preview && now.getMinutes() === 59 ? Math.random() * 30000 : 0),
      };
    }
    if (nextPrefetch && (preview || +now >= nextPrefetch.at)) {
      data.request(nextPrefetch.code);
      nextPrefetch = null;
    }
    sourceTime.setAttribute(
      'aria-label',
      t('clockTime', {
        hours: pad(now.getHours()),
        minutes: pad(now.getMinutes()),
        seconds: pad(seconds),
      }),
    );
    const snapshot = sharing.snapshotAt(code, seconds),
      ast = snapshot ? snapshot.ast : result?.solutions[seconds] || null;
    renderExpression(ast, code, seconds, !result);
    prepareNext(now);
    ticks.forEach((el, i) => {
      const saved = sharing.snapshotAt(code, i),
        entry = saved ? saved.ast : result?.solutions[i];
      el.classList.toggle('solved', !!entry);
      el.classList.toggle('current', i === seconds);
      el.classList.toggle('past', i < seconds);
      if (i === seconds) el.setAttribute('aria-current', 'time');
      else el.removeAttribute('aria-current');
      const status = t(
        saved
          ? saved.ast
            ? 'formulaAvailable'
            : 'noFormula'
          : result
            ? result.error
              ? 'dataFailed'
              : entry
                ? 'formulaAvailable'
                : 'noFormula'
            : 'loading',
      );
      el.title = t('secondStatus', { seconds: pad(i), status });
    });
    const label = $('#state-label');
    label.className = 'state-label';
    if (now.getHours() === 23 && now.getMinutes() === 59 && seconds >= 57) {
      label.textContent = t('newDayIn', { seconds: 60 - seconds });
      label.classList.add('counting');
    } else if (now.getHours() === 0 && now.getMinutes() === 0 && seconds === 0) {
      label.textContent = t('newDay');
      label.classList.add('counting');
    } else if (snapshot) label.textContent = '';
    else if (!result) label.textContent = t('loadingData');
    else if (result.error) label.textContent = t('dataClockFallback');
    else if (!ast) {
      label.textContent = '';
      label.classList.add('quiet');
    } else label.textContent = '';
    if (changed && previousSecond !== null && seconds === 0 && !preview?.paused) {
      $('#flash').animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], {
        duration: reducedMotion.matches ? 200 : 1650,
      });
    }
  }
  function scheduleTick() {
    clearTimeout(tickTimer);
    if (preview?.paused) return;
    const now = +getNow();
    const delay = Math.max(12, 1000 - (now % 1000) + 3);
    tickTimer = setTimeout(() => {
      refresh();
      scheduleTick();
    }, delay);
  }

  const sound = createTimeSignal({
    t,
    getNow: () => getNow(),
    isPaused: () => !!preview?.paused,
    generation: () => generation,
  });
  $<HTMLButtonElement>('#go-live').addEventListener('click', goLive);
  $<HTMLButtonElement>('#custom-go').addEventListener('click', () => {
    const value = $<HTMLInputElement>('#custom-time').value;
    if (!/^\d\d:\d\d(?::\d\d)?$/.test(value)) return;
    const [h, m, s = 0] = value.split(':').map(Number),
      d = new Date();
    d.setHours(h, m, s, 0);
    setPreview(d, true);
    settingsDialog.close();
  });
  const fullscreen = createFullscreen({
    t,
    notify: (text) => sharing.showNotice(text),
    renderResize,
  });
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (
      settingsDialog.open ||
      licenseDialog.open ||
      shareDialog.open ||
      e.defaultPrevented ||
      e.isComposing ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      (target instanceof Element && target.closest('input,textarea,select')) ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;
    // Ruler buttons retain focus after a click; arrows should still seek there.
    if (!e.shiftKey && preview?.paused && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      stepSecond(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (target instanceof Element && target.closest('button,summary,a')) return;
    if (e.repeat) {
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    if (e.key.toLowerCase() === 'm') sound.toggle();
    if (e.key.toLowerCase() === 'l') goLive();
    if (e.key.toLowerCase() === 'f') fullscreen.toggle();
    if (e.code === 'Space') {
      e.preventDefault();
      if (preview?.paused) goLive();
      else pauseClock();
    }
  });
  document.addEventListener('click', (event) => sound.resumeGesture(event));
  document.addEventListener('keydown', (event) => sound.resumeGesture(event));
  function renderResize() {
    const d = getNow(),
      code = timeCode(d),
      result = data.getMinute(code);
    renderExpression(
      result?.solutions[d.getSeconds()] || null,
      code,
      d.getSeconds(),
      !result,
      true,
    );
  }
  new ResizeObserver(renderResize).observe(stage);
  reducedMotion.addEventListener?.('change', renderResize);
  document.addEventListener('visibilitychange', () => {
    sound.cancel();
    if (document.hidden) clearTimeout(tickTimer);
    else {
      lastSecond = null;
      refresh(true);
      scheduleTick();
    }
  });
  if (sharedState) resetTransport();
  else {
    refresh(true);
    scheduleTick();
  }
  setInterval(() => sound.poll(), 60);
  // Read-only handles for tests, with explicit transport controls for reproducible previews.
  window.FormulaClock = Object.freeze({
    preview: (time: string | Date, paused = true) => {
      const d = time instanceof Date ? time : new Date(time);
      setPreview(d, paused);
    },
    live: goLive,
    pause: pauseClock,
    setDisplay: settings.setDisplay,
    setDataProvider,
    get state() {
      return {
        display: { ...settings.current },
        dataRevision: data.revision,
        dataError: data.getMinute(timeCode(getNow()))?.error || null,
        now: getNow().toISOString(),
        preview: !!preview,
        paused: preview?.paused || false,
        layout: latestLayout,
        coverage: data.getMinute(timeCode(getNow()))?.count,
        audio: sound.history(),
        soundEnabled: sound.enabled,
        soundReady: sound.ready,
        soundVolume: sound.volume,
        engineReady: settings.engine().ready,
        engineError,
        typesetCacheSize: settings.engine().cache.size,
      };
    },
    get digits() {
      return [...digitsEls];
    },
    diagnostics() {
      const host = stage.getBoundingClientRect();
      return {
        build: 'r6-minimal',
        mathjax: settings.engine().mathjax?.version || null,
        display: { ...settings.current },
        userAgent: navigator.userAgent,
        locale: ui.locale,
        engineError,
        typography: settings.engine().typography,
        axisY: latestLayout?.axisY,
        localAxisY: latestLayout?.localAxisY,
        time: latestLayout ? `${latestLayout.code}:${pad(latestLayout.seconds)}` : null,
        glyphs: movingEls.map((el) => {
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
        }),
      };
    },
  });
})();
