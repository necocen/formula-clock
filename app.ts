import {isRecord, type DisplayOptions, type FormulaProvider, type Expr, type SecondEntries, type SharedSnapshot, type SharedView, type LayoutItem, type ClockLayout, type AudioEvent} from './types.ts';
import type {Typesetter} from './typesetter.ts';
import type {ClockFace,Frame,PlacedToken} from './browser-types.ts';

interface MinuteSolutions {input: string; solutions: SecondEntries; count: number; error?: string; retryAfter?: number;}
interface Movement {from: number[]; to: number[]; started: number;}
type MovingElement = SVGGElement & {_shapeKey?: string};
interface MorphState {angle: number; weights: Record<string,number>; center: number[];}
interface MorphPart {group: SVGGElement; shape: Node; center: number[];}
interface Morph {parts: Record<string,MorphPart>; from: MorphState; to: {angle: number; center: number[]}; started: number; target: string;}
interface SymbolRecord {el: MovingElement; token: PlacedToken; exiting?: boolean; animation?: Animation | null;}
interface DisplayedFrame {frame: Frame; ast: Expr | null; code: string; seconds: number; view: DisplayOptions;}
interface Preview {epoch: number; started: number; speed: number; paused: boolean;}
/* Formula Clock: persistent digit objects, separate typography and data delivery. */
(() => {
  'use strict';
  const ui = FormulaI18n.create(navigator.languages?.[0] || navigator.language), t = ui.t;
  ui.apply(document);
  function $<T extends Element = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing clock element ${selector}`);
    return element;
  }
  const stage = $('#stage'), digitsEls = [...stage.querySelectorAll<MovingElement>('.digit')];
  const sourceTime = $('#source-time'), sourceEls = [...sourceTime.querySelectorAll<MovingElement>('.source-digit')];
  const sourceColons = [...sourceTime.querySelectorAll<MovingElement>('.colon')];
  const cache = new Map<string,MinuteSolutions>(), pending = new Map<string,AbortController>();
  const settingsDialog = $<HTMLDialogElement>('#settings'), settingsButton = $<HTMLButtonElement>('#settings-open');
  const licenseDialog = $<HTMLDialogElement>('#licenses');
  const shareButton = $<HTMLButtonElement>('#share'), shareDialog = $<HTMLDialogElement>('#share-dialog');
  let sharedView: SharedView | null = null;
  try {
    const embedded = document.querySelector('#shared-clock');
    if (embedded) {
      const candidate = FormulaShare.view(JSON.parse(embedded.textContent || ''));
      if (candidate.id === FormulaShare.id(location.pathname)) sharedView = candidate;
    }
  } catch (error) { console.warn('[Formula Clock] Invalid shared snapshot.',error); }
  const sharedState = sharedView?.snapshot || FormulaShare.parse(new URL(location.href));
  let activeSnapshot: SharedSnapshot | null = sharedView?.snapshot || null;
  let sharedAddress = !!sharedState;
  const shareLinks = new FormulaShare.LinkCache(sharedView);
  let shareSerial = 0, shareBusy = false;
  let shareWarmTimer: ReturnType<typeof setTimeout> | undefined, shareWarmKey = '';
  function snapshotAt(code: string,seconds: number) { return activeSnapshot?.t === code+pad(seconds) ? activeSnapshot : null; }
  function leaveSharedView(keepFormula = false) {
    if (!keepFormula) activeSnapshot = null;
    ++shareSerial; shareLinks.cancelPending(); clearTimeout(shareWarmTimer); shareWarmKey = ''; shareBusy = false; lastVisual = '';
    shareButton.removeAttribute('aria-busy'); showNotice('');
    if (shareDialog.open) shareDialog.close();
    if (sharedAddress) {
      const target = new URL(location.href); target.search = ''; target.hash = '';
      // file:// previews retain their pathname; changing it would fail the origin check.
      if (['http:','https:'].includes(target.protocol)) target.pathname = '/';
      history.replaceState(history.state,'',target); document.title = FormulaShare.title(null); sharedAddress = false;
    }
  }
  function setupDialog(dialog: HTMLDialogElement, opener: HTMLButtonElement, closeButton: HTMLButtonElement, openOnClick = true) {
    if (openOnClick) opener.addEventListener('click', () => {
      dialog.showModal(); closeButton.focus({preventScroll:true}); dialog.scrollTop = 0;
    });
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => opener.focus({preventScroll:true}));
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button,input,select,summary,a[href]')]
        .filter(el => !('disabled' in el && el.disabled) && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    // Dragging out from a control must not count as a backdrop click.
    let backdropPointer = false;
    function outsideDialog(event: MouseEvent) {
      const r = dialog.getBoundingClientRect();
      return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    }
    dialog.addEventListener('pointerdown', event => { backdropPointer = outsideDialog(event); });
    dialog.addEventListener('click', event => {
      if (backdropPointer && outsideDialog(event)) dialog.close();
      backdropPointer = false;
    });
  }
  setupDialog(settingsDialog,settingsButton,$<HTMLButtonElement>('#settings-close'));
  setupDialog(licenseDialog,$<HTMLButtonElement>('#licenses-open'),$<HTMLButtonElement>('#licenses-close'));
  setupDialog(shareDialog,shareButton,$<HTMLButtonElement>('#share-close'),false);
  shareButton.hidden = !['http:','https:'].includes(location.protocol);
  const {normalizeMinute, TableProvider} = FormulaData;
  const defaultProvider = () => new TableProvider(async () => {
    const embedded = document.querySelector<HTMLElement>('#clock-data');
    if (!embedded) throw new Error('No embedded formula table or custom provider');
    return FormulaData.loadEmbedded(embedded);
  });
  let provider = window.FORMULA_CLOCK_CONFIG?.provider || defaultProvider();
  let dataRevision = 0;
  function savedDisplay(): Record<string,unknown> {
    try { const saved: unknown = JSON.parse(localStorage.getItem('formula-clock-display-v2') || '{}'); return isRecord(saved) ? saved : {}; } catch { return {}; }
  }
  function activeDisplay(options: DisplayOptions = displaySettings): DisplayOptions {
    return {...options,structureMotion:options.symbolMotion && options.structureMotion,
      symbolMorph:options.symbolMotion && options.symbolMorph};
  }
  const saved = savedDisplay();
  let displaySettings: DisplayOptions = {
    font: typeof saved.font === 'string' && Object.hasOwn(FormulaTypesetter.PROFILES,saved.font) ? saved.font as DisplayOptions['font'] : 'stix2',
    // Preserve the appearance of settings saved before numeral styles were independent.
    numerals: typeof saved.numerals === 'string' && Object.hasOwn(FormulaTypesetter.NUMERALS,saved.numerals) ? saved.numerals as DisplayOptions['numerals'] : saved.font === 'euler' ? 'lining' : 'oldstyle',
    division: saved.division === 'fraction' || saved.division === 'inline' || saved.division === 'slash' ? saved.division : 'fraction',
    symbolMotion: saved.symbolMotion !== false,
    structureMotion: saved.structureMotion !== false,
    symbolMorph: saved.symbolMorph !== false
  };
  // Restore before selecting an engine; opening a link never saves preferences.
  if (sharedState) {
    const {font,numerals,division} = sharedState;
    Object.assign(displaySettings,{font,numerals,division});
    document.title = FormulaShare.title(sharedState);
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeCode = (d: Date) => pad(d.getHours()) + pad(d.getMinutes());
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const b = document.createElement('button'); b.className = 'tick' + (i % 5 === 0 ? ' major' : '');
    b.setAttribute('aria-label',t('previewSecond',{seconds:i}));
    b.addEventListener('click', () => { const d = getNow(); d.setSeconds(i, 0); setPreview(d, true); });
    $('#ruler').append(b); return b;
  });
  function requestSolutions(code: string) {
    const existing = cache.get(code);
    if (pending.has(code) || (existing && (!existing.error || Date.now() < (existing.retryAfter || 0)))) return;
    const revision = dataRevision, currentProvider = provider, controller = new AbortController();
    pending.set(code,controller);
    Promise.resolve().then(() => currentProvider.getMinute(code,{signal:controller.signal})).then(raw => {
      if (revision !== dataRevision || controller.signal.aborted) return;
      const minute = normalizeMinute(raw,code);
      cache.set(code, {input:code, solutions:minute.seconds, count:minute.seconds.filter(Boolean).length});
    }).catch(error => {
      if (revision !== dataRevision || controller.signal.aborted) return;
      console.warn('[Formula Clock] Formula data unavailable.',error);
      cache.set(code,{input:code,solutions:Array(60).fill(null),count:0,error:String(error),retryAfter:Date.now()+5000});
    }).finally(() => {
      if (revision !== dataRevision) return;
      if (pending.get(code) === controller) pending.delete(code);
      while (cache.size > 10) cache.delete(cache.keys().next().value!);
      if (timeCode(getNow()) === code) refresh(true);
    });
  }
  function setDataProvider(next: FormulaProvider) {
    if (!next || typeof next.getMinute !== 'function') throw new TypeError('Provider needs getMinute(hhmm, {signal})');
    leaveSharedView();
    dataRevision++;
    pending.forEach(controller => controller.abort()); pending.clear(); cache.clear();
    provider = next; lastVisual = ''; lastCode = null; ++requestSerial;
    refresh(true);
  }

  // MathJax computes the layout; persistent digits and equality display it.
  // The four HHMM objects are never recreated, including ordinary clock mode.
  const engines = new Map<string,Typesetter>(), clockFaces = new Map<string,ClockFace>();
  const typographyKey = (font: DisplayOptions['font'],numerals: DisplayOptions['numerals']) => `${font}:${numerals}`;
  function engineFor(font: DisplayOptions['font'],numerals: DisplayOptions['numerals']): Typesetter {
    const key = typographyKey(font,numerals);
    const selected = () => typographyKey(displaySettings.font,displaySettings.numerals) === key;
    if (!engines.has(key)) {
      const engine = new FormulaTypesetter.Typesetter(font,numerals);
      engines.set(key,engine);
      engine.clockFace().then(face => {
        clockFaces.set(key,face);
        if (selected()) { lastVisual=''; refresh(true); }
      }).catch(error => console.warn('[Formula Clock] Small clock font unavailable.',error));
      engine.boot.then(() => {
        if (selected()) { lastVisual=''; refresh(true); }
      }).catch(error => {
        if (selected()) { engineError=String(error); lastVisual=''; refresh(true); }
      });
    }
    return engines.get(key)!;
  }
  let typesetter = engineFor(displaySettings.font,displaySettings.numerals);
  const segmentedChoices = [...settingsDialog.querySelectorAll<HTMLInputElement>('.segmented-control input')];
  function syncMotionControls() {
    $<HTMLInputElement>('#symbol-motion').checked = displaySettings.symbolMotion;
    $<HTMLInputElement>('#structure-motion').checked = displaySettings.structureMotion;
    $<HTMLInputElement>('#structure-motion').disabled = !displaySettings.symbolMotion;
    $<HTMLInputElement>('#symbol-morph').checked = displaySettings.symbolMorph;
    $<HTMLInputElement>('#symbol-morph').disabled = !displaySettings.symbolMotion;
  }
  async function setDisplay(changes: Partial<DisplayOptions>) {
    const next = {...displaySettings,...changes};
    if (!Object.hasOwn(FormulaTypesetter.PROFILES,next.font) || !Object.hasOwn(FormulaTypesetter.NUMERALS,next.numerals) || !['fraction','inline','slash'].includes(next.division) || (['symbolMotion','structureMotion','symbolMorph'] as const).some(key=>typeof next[key] !== 'boolean')) throw new TypeError('Invalid display options');
    leaveSharedView(true); // Restyle the saved formula until the user changes time.
    displaySettings = {font:next.font,numerals:next.numerals,division:next.division,symbolMotion:next.symbolMotion,structureMotion:next.structureMotion,symbolMorph:next.symbolMorph};
    shareButton.disabled = true;
    syncMotionControls();
    $<HTMLSelectElement>('#font-choice').value = next.font;
    segmentedChoices.forEach(input => { input.checked = input.value === next[input.name as keyof DisplayOptions]; });
    try {localStorage.setItem('formula-clock-display-v2',JSON.stringify(displaySettings));} catch {}
    typesetter = engineFor(next.font,next.numerals); engineError=null; lastVisual='';
    refresh(true);
    await typesetter.boot;
  }
  syncMotionControls();
  $<HTMLInputElement>('#symbol-motion').addEventListener('change',e=>{setDisplay({symbolMotion:(e.target as HTMLInputElement).checked}).catch(()=>{});});
  $<HTMLInputElement>('#structure-motion').addEventListener('change',e=>{setDisplay({structureMotion:(e.target as HTMLInputElement).checked}).catch(()=>{});});
  $<HTMLInputElement>('#symbol-morph').addEventListener('change',e=>{setDisplay({symbolMorph:(e.target as HTMLInputElement).checked}).catch(()=>{});});
  $<HTMLSelectElement>('#font-choice').value = displaySettings.font;
  segmentedChoices.forEach(input => { input.checked = input.value === displaySettings[input.name as keyof DisplayOptions]; });
  $<HTMLSelectElement>('#font-choice').addEventListener('change',e=>{setDisplay({font:(e.target as HTMLSelectElement).value as DisplayOptions['font']}).catch(()=>{});});
  $('#numeral-choice').addEventListener('change',e=>{setDisplay({numerals:(e.target as HTMLInputElement).value as DisplayOptions['numerals']}).catch(()=>{});});
  $('#division-choice').addEventListener('change',e=>{setDisplay({division:(e.target as HTMLInputElement).value as DisplayOptions['division']}).catch(()=>{});});
  const scene = $<SVGSVGElement>('#math-scene'), notationRoot = $<MovingElement>('#notation-root'), equalSign = $<MovingElement>('#equal-sign');
  const operatorRoot = $<MovingElement>('#operator-root'), symbolRecords = new Set<SymbolRecord>();
  const secondsEls = [...scene.querySelectorAll<MovingElement>('.answer-digit')];
  const movingEls = [...digitsEls, ...secondsEls];
  const plainTime = $('#plain-time');
  const movement = new Map<MovingElement,Movement>();
  const morphs = new Map<MovingElement,Morph>();
  let notation: SVGGElement | null = null, lastVisual = '', firstFrame = true;
  let latestLayout: ClockLayout | null = null, displayedFrame: DisplayedFrame | null = null;
  let requestSerial = 0, animationId = 0;
  let engineError: string | null = null;
  const reportedRenderErrors = new Set<string>();
  const mathNS = 'http://www.w3.org/2000/svg';
  const DURATION = 680;
  const MORPH_DURATION = 320;
  const matrixString = (a: number[]) => `matrix(${a.map(n => n.toFixed(7)).join(' ')})`;
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
      paintMorph(record,now);
      if (now - record.started < MORPH_DURATION) active = true;
      else finishMorph(el);
    }
    animationId = active ? requestAnimationFrame(animatePositions) : 0;
  }
  function setPosition(el: MovingElement, target: number[], animated: boolean, now: number) {
    const old = movement.get(el);
    const from = old ? matrixAt(old, now) : target;
    movement.set(el, { from: animated ? from : target, to: target, started: animated ? now : now - DURATION });
    el.setAttribute('transform', matrixString(animated ? from : target));
    if (animated && !animationId) animationId = requestAnimationFrame(animatePositions);
  }
  function fadeIn(el: Element, duration: number, delayed = false) {
    if (reducedMotion.matches) return;
    el.animate(delayed ? [{ opacity: 0 }, { opacity: 0, offset: .18 }, { opacity: 1 }] : [{ opacity: .15 }, { opacity: 1 }], { duration, easing: 'ease-out' });
  }
  function morphStateAt(record: Morph,now: number): MorphState {
    const p = Math.min(1,Math.max(0,(now-record.started)/MORPH_DURATION));
    const k = p*p*(3-2*p), mix = (a: number,b: number)=>a+(b-a)*k;
    return {angle:mix(record.from.angle,record.to.angle),
      weights:Object.fromEntries(Object.keys(record.parts).map(kind=>[kind,mix(record.from.weights[kind] || 0,kind===record.target?1:0)])),
      center:record.from.center.map((v,i)=>mix(v,record.to.center[i]))};
  }
  function paintMorph(record: Morph,now: number) {
    const state=morphStateAt(record,now);
    for (const [kind,part] of Object.entries(record.parts)) {
      const angle=state.angle-(kind==='×'?45:0);
      part.group.setAttribute('transform',`translate(${state.center.join(' ')}) rotate(${angle}) translate(${-part.center[0]} ${-part.center[1]})`);
      part.group.setAttribute('opacity',String(state.weights[kind]));
    }
    return state;
  }
  function finishMorph(el: MovingElement) {
    const record=morphs.get(el);
    if (!record) return;
    el.replaceChildren(record.parts[record.target].shape);
    el.removeAttribute('data-morphing');morphs.delete(el);
  }
  function startMorph(el: MovingElement,oldToken: PlacedToken,token: PlacedToken,now: number) {
    if (!oldToken.inkCenter || !token.inkCenter) return;
    const existing=morphs.get(el);
    const from=existing ? paintMorph(existing,now) : {
      angle:oldToken.kind==='×'?45:0,weights:{[oldToken.kind]:1},center:oldToken.inkCenter
    };
    el.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
    const parts=existing?.parts || {};
    for (const glyph of [oldToken,token]) {
      if (parts[glyph.kind]) continue;
      const group=document.createElementNS(mathNS,'g'),shape=glyph.shape.cloneNode(true);
      group.dataset.morphGlyph=glyph.kind;group.append(shape);
      parts[glyph.kind]={group,shape,center:glyph.inkCenter!};
    }
    // Preserve every visible contribution when interrupted by a third sign.
    // One layer per arithmetic glyph bounds even rapid switching to four;
    // completion restores the exact native destination glyph.
    const record={parts,from,to:{angle:token.kind==='×'?45:0,center:token.inkCenter},started:now,target:token.kind};
    el.replaceChildren(...Object.values(parts).map(part=>part.group));
    el.dataset.morphing='true';el.dataset.value=token.text;el._shapeKey=token.shape.innerHTML;
    morphs.set(el,record);paintMorph(record,now);
  }
  function updateSymbols(tokens: PlacedToken[],animated: boolean,placeToken: (token: PlacedToken, el: MovingElement, morphFrom: PlacedToken | null) => void,morphEnabled: boolean) {
    const previous=[...symbolRecords];
    const old=previous.map(record=>({...record.token,exiting:record.exiting}));
    const matches=FormulaSymbols.match(old,tokens,{morph:animated && morphEnabled}),used=new Set();
    tokens.forEach((token,i)=>{
      let record=previous[matches[i]];
      if(!record) {
        const el=document.createElementNS(mathNS,'g');
        el.classList.add('moving-symbol');operatorRoot.append(el);
        record={el,token};symbolRecords.add(record);
      } else if(record.animation) {
        const opacity=getComputedStyle(record.el).opacity;
        record.animation.cancel();record.animation=null;
        if(animated)record.el.animate([{opacity},{opacity:1}],{duration:180});
      }
      const oldToken=record.token;
      used.add(record);record.exiting=false;record.token=token;
      record.el.dataset.kind=token.kind;
      record.el.dataset.site=token.site || '';
      record.el.dataset.glyphKey=token.glyphKey || '';
      placeToken(token,record.el,oldToken && FormulaSymbols.morphPair(oldToken,token) ? oldToken : null);
    });
    for(const record of previous) if(!used.has(record)) {
      const remove=()=>{record.el.remove();movement.delete(record.el);morphs.delete(record.el);symbolRecords.delete(record);};
      if(!animated){record.animation?.cancel();remove();continue;}
      if(record.exiting)continue;
      record.exiting=true;
      const animation=record.el.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'});
      record.animation=animation;
      animation.onfinish=()=>{if(record.animation===animation && record.exiting)remove();};
    }
  }
  function renderStatus(message = '') {
    const status = $('#render-status');
    status.textContent = message; status.hidden = !message;
  }
  function plainFallback(code: string, seconds: number, reason: string) {
    shareButton.disabled = true;
    const full = `${code.slice(0,2)}:${code.slice(2)}:${pad(seconds)}`;
    [...plainTime.querySelectorAll('span')].forEach((el, i) => { el.textContent = full[i]; });
    plainTime.hidden = false; scene.style.visibility = 'hidden';
    sourceTime.hidden = true;
    stage.classList.add('resting');
    stage.setAttribute('aria-label', full);
    renderStatus(reason);
  }
  function renderSourceTime(font: DisplayOptions['font'], numerals: DisplayOptions['numerals'], code: string, seconds: number, visible: boolean) {
    const face = clockFaces.get(typographyKey(font,numerals));
    if (face) {
      const colon = face.glyphs[':'];
      // Six equal 500-unit cells keep every digit stationary, even with oldstyle
      // or proportional glyphs. Fixed 450-unit separators match ordinary clock spacing.
      const centers = [400,900,1850,2350,3300,3800];
      const baseline = 550 - (colon.bounds.y + colon.bounds.h / 2) * face.scale;
      const place = (el: MovingElement, text: string, center: number) => {
        const token = face.glyphs[text];
        if (el.dataset.font === font && el.dataset.numerals === numerals && el.dataset.value === text) return;
        const matrix = token.matrix.map(value => value * face.scale);
        matrix[4] += center - (token.bounds.x + token.bounds.w / 2) * face.scale;
        matrix[5] += baseline;
        el.replaceChildren(token.shape.cloneNode(true));
        el.setAttribute('transform',matrixString(matrix));
        el.dataset.font = font; el.dataset.numerals = numerals; el.dataset.value = text;
      }
      const text = code + pad(seconds);
      sourceEls.forEach((el,i) => place(el,text[i],centers[i]));
      sourceColons.forEach((el,i) => place(el,':',1375 + i * 1450));
      sourceTime.dataset.font = font;
      sourceTime.dataset.numerals = numerals;
    }
    sourceTime.hidden = !visible || !face;
  }
  function applyFrame(frame: Frame, ast: Expr | null, code: string, seconds: number, loading: boolean, instant: boolean, view: DisplayOptions) {
    const W = stage.clientWidth, H = stage.clientHeight, b = frame.viewBox;
    // Fit each side of a fixed axis independently. A tall numerator may shrink
    // the equation, but must never push the equal sign or normal digits down.
    const maxFontSize = document.body.classList.contains('fullscreen') ? H * .7 : 112;
    const {axis,scale,x,y} = FormulaDisplay.fitFrame(b,frame.axisY,W,H,maxFontSize);
    const fit = new DOMMatrix([scale, 0, 0, scale, x, y]);
    const animated = !instant && !firstFrame && !reducedMotion.matches;
    // One clock for the entire frame keeps a radical and its rule joined, even
    // if DOM work between their updates takes a few milliseconds.
    const positionTime = performance.now();
    const items: LayoutItem[] = [];
    function placeToken(token: PlacedToken, el: MovingElement, morphFrom: PlacedToken | null = null) {
      if (morphFrom && animated && view.symbolMorph) startMorph(el,morphFrom,token,positionTime);
      else if (!animated || !view.symbolMorph || el._shapeKey !== token.shape.innerHTML || el.dataset.value !== token.text) finishMorph(el);
      // A preference change may interrupt an existing fade on a reused glyph.
      if (!animated) el.getAnimations({subtree:true}).forEach(animation => animation.cancel());
      // Preserve the glyph's child nodes too until this clock position changes digit.
      if (el.dataset.value !== token.text || !el.firstChild || el._shapeKey !== token.shape.innerHTML) {
        el.replaceChildren(token.shape.cloneNode(true));
        if (animated) fadeIn(el.firstElementChild!, 350);
        el.dataset.value = token.text;
        el._shapeKey = token.shape.innerHTML;
      }
      const m = fit.multiply(new DOMMatrix(token.matrix));
      const target = [m.a, m.b, m.c, m.d, m.e, m.f];
      setPosition(el, target, animated, positionTime);
      return { slot: token.slot, text: token.text, matrix: target,
        localMatrix: token.matrix.slice(), scale: Math.hypot(token.matrix[0], token.matrix[1]) };
    }
    frame.tokens.forEach((token, i) => items.push(placeToken(token,movingEls[i])));
    // Equality keeps its glyph and interpolates with the digits; other signs fade.
    if (frame.equality) placeToken(frame.equality,equalSign);
    equalSign.style.opacity = frame.equality ? '1' : '0';
    updateSymbols(frame.symbols,animated,placeToken,view.symbolMorph);
    const layer = document.createElementNS(mathNS, 'g');
    layer.classList.add('notation-layer');
    const content = frame.decorations.cloneNode(true) as SVGGElement;
    content.setAttribute('transform', matrixString([scale,0,0,scale,x,y]));
    layer.append(content); notationRoot.append(layer);
    if (notation) {
      const old = notation;
      if (animated) {
        // Finish any half-completed fade-in before starting a fade-out.
        const opacity = getComputedStyle(old).opacity;
        old.getAnimations().forEach(a => a.cancel());
        const a = old.animate([{ opacity }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
        a.onfinish = () => old.remove();
      } else old.remove();
    }
    if (animated) fadeIn(layer, 590, true);
    notation = layer;
    stage.classList.toggle('resting', !ast);
    stage.classList.toggle('loading', loading);
    plainTime.hidden = true; scene.style.visibility = 'visible';
    renderSourceTime(frame.font,frame.numerals,code,seconds,!!ast && !loading);
    renderStatus();
    const time = t('clockTime',{hours:code.slice(0,2),minutes:code.slice(2),seconds});
    stage.setAttribute('aria-label',ast ? t('clockEquation',{time,expression:FormulaExpression.plain(ast,code),seconds}) : time);
    latestLayout = { display:{...view}, ast, code, seconds, mode: ast ? 'formula' : 'time', tex: frame.tex, items, width: b.w * scale, height: b.h * scale, viewBox: { ...b }, fontSize: scale * 1000, axisY: axis, localAxisY: frame.axisY, fit: [scale,0,0,scale,x,y], typography: frame.typography };
    displayedFrame = {frame,ast,code,seconds,view};
    if (sharedAddress && !loading && !engineError) document.title = FormulaShare.title({v:1,t:code+pad(seconds),...view,ast});
    shareButton.disabled = shareBusy || loading || !!engineError || (!snapshotAt(code,seconds) && (!cache.has(code) || !!cache.get(code)?.error));
    preparePausedShare();
    firstFrame = false;
  }
  function renderExpression(ast: Expr | null, code: string, seconds: number, loading: boolean, instant = false) {
    const snapshot = snapshotAt(code,seconds);
    if (snapshot) { ast = snapshot.ast; loading = false; }
    if (loading) shareButton.disabled = true;
    const engine = typesetter, view = activeDisplay();
    const key = `${view.font}:${view.numerals}:${view.division}:${view.symbolMotion}:${view.structureMotion}:${view.symbolMorph}:${JSON.stringify(ast)}:${code}:${seconds}:${stage.clientWidth}:${stage.clientHeight}:${loading}`;
    if (lastVisual === key && !instant) return;
    lastVisual = key;
    const serial = ++requestSerial;
    if (!engine.ready) plainFallback(code,seconds,t(engine.error ? 'typesettingFailed' : 'preparing'));
    if (engine.error) return;
    engine.frame(ast, code, seconds, view).then(frame => {
      if (serial !== requestSerial) return; // Discard any stale async result.
      engineError = null;
      applyFrame(frame, ast, code, seconds, loading, instant, view);
    }).catch(async error => {
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
        } catch { /* Ordinary text fallback below. */ }
      }
      plainFallback(code,seconds,t('typesettingFailed'));
    });
  }
  // Warm only the immediately upcoming frames; do not queue a minute of work
  // ahead of interactive previews. The LRU retains recent typesetting results.
  function prepareNext(now: Date) {
    if (!typesetter.ready || preview?.paused || document.hidden) return;
    for (const offset of [1, 2]) {
      const next = new Date(+now + offset * 1000), code = timeCode(next), result = cache.get(code);
      if (result) typesetter.frame(result.solutions[next.getSeconds()] || null, code, next.getSeconds(), activeDisplay()).catch(() => {});
    }
  }
  // Transport time is anchored to the wall clock (live) or a monotonic clock (preview).
  let preview: Preview | null = sharedState ? {epoch:+FormulaShare.localDate(sharedState.t),started:performance.now(),speed:1,paused:true} : null;
  let generation = 0, lastSecond: number | null = null, lastCode: string | null = null;
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let nextPrefetch: {code: string; at: number} | null = null;
  const eventHistory: AudioEvent[] = [];
  function getNow() { return preview ? new Date(preview.epoch + (preview.paused ? 0 : performance.now() - preview.started) * preview.speed) : new Date(); }
  function setPreview(date: Date, paused = false) {
    if (!(date instanceof Date) || !Number.isFinite(+date)) return;
    leaveSharedView();
    preview = { epoch: +date, started: performance.now(), speed: 1, paused };
    resetTransport();
  }
  function resetTransport() {
    generation++; lastSecond = null; sound.cancel();
    document.body.classList.toggle('preview-mode', !!preview);
    $('#transport').hidden = !preview;
    $<HTMLButtonElement>('#play-pause').textContent = t(preview?.paused ? 'play' : 'pause');
    $<HTMLButtonElement>('#slow').setAttribute('aria-pressed', String(!!preview && preview.speed < 1));
    refresh(true); scheduleTick();
  }
  function goLive() { leaveSharedView(); preview = null; resetTransport(); }
  function togglePlay() {
    if (!preview) return;
    leaveSharedView();
    preview = { ...preview, epoch: +getNow(), started: performance.now(), paused: !preview.paused };
    resetTransport();
  }
  function toggleSlow() {
    if (!preview) return;
    leaveSharedView();
    preview = { ...preview, epoch: +getNow(), started: performance.now(), speed: preview.speed === 1 ? .5 : 1 };
    resetTransport();
  }
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function showNotice(text: string) {
    clearTimeout(noticeTimer);
    $('#share-status').textContent = text;
    noticeTimer = setTimeout(() => { $('#share-status').textContent = ''; },4000);
  }
  function manualShare(url: string) {
    const input = $<HTMLInputElement>('#share-url'); input.value = url;
    $<HTMLButtonElement>('#share-native').hidden = typeof navigator.share !== 'function';
    if (!shareDialog.open) shareDialog.showModal(); input.focus(); input.select();
  }
  async function copyShare(url: string,serial = shareSerial) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (serial === shareSerial) { if (shareDialog.open) shareDialog.close(); showNotice(t('shareCopied')); }
    } catch { if (serial === shareSerial) manualShare(url); }
  }
  function deliverShare(url: string,state: SharedSnapshot,serial: number) {
    if (serial !== shareSerial) return;
    if (typeof navigator.share !== 'function') { void copyShare(url,serial); return; }
    if (navigator.userActivation && !navigator.userActivation.isActive) { manualShare(url); return; }
    const failed = (error: unknown) => {
      if (serial !== shareSerial || ((isRecord(error) || error instanceof Error) && error.name === 'AbortError')) return;
      manualShare(url);
    };
    const card = FormulaShare.card(state);
    try { void navigator.share({title:card.title,url}).catch(failed); } catch (error) { failed(error); }
  }
  function displayedSnapshot(): SharedSnapshot | null {
    if (!displayedFrame || shareButton.disabled || shareButton.hidden || document.hidden) return null;
    const {code,seconds,view,ast} = displayedFrame;
    return FormulaShare.snapshot({v:1,t:code+pad(seconds),font:view.font,numerals:view.numerals,division:view.division,ast});
  }
  function preparePausedShare() {
    const state = preview?.paused ? displayedSnapshot() : null;
    if (!state) { clearTimeout(shareWarmTimer); return; }
    const key = JSON.stringify(state);
    if (key === shareWarmKey) return;
    clearTimeout(shareWarmTimer); shareWarmKey = key;
    const serial = shareSerial;
    // Coalesce quick ruler/settings changes; failures stay quiet until a real share.
    shareWarmTimer = setTimeout(() => {
      if (serial === shareSerial && JSON.stringify(displayedSnapshot()) === key) void shareLinks.prepare(state).catch(() => {});
    },250);
  }
  function prepareShareOnIntent() {
    const state = displayedSnapshot();
    if (!state) return;
    void shareLinks.prepare(state).catch(() => {});
    if (preview?.paused) return;
    // Only this gesture warms the next two seconds; the running clock never
    // continuously writes to KV. Exact AST/settings keys guard second boundaries.
    const now = FormulaShare.localDate(state.t);
    for (const offset of [1,2]) {
      const next = new Date(+now + offset*1000), code = timeCode(next), result = cache.get(code);
      if (!result || result.error) continue;
      void shareLinks.prepare({...state,t:code+pad(next.getSeconds()),ast:result.solutions[next.getSeconds()] || null}).catch(() => {});
    }
  }
  for (const event of ['pointerenter','focus','pointerdown']) shareButton.addEventListener(event,prepareShareOnIntent);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) { clearTimeout(shareWarmTimer); shareWarmKey = ''; if (!shareBusy) shareLinks.cancelPending(); }
    else preparePausedShare();
  });
  $('#share-copy').addEventListener('click',() => { void copyShare($<HTMLInputElement>('#share-url').value); });
  $('#share-native').addEventListener('click',() => {
    if (activeSnapshot) deliverShare($<HTMLInputElement>('#share-url').value,activeSnapshot,shareSerial);
  });
  shareButton.addEventListener('click', async () => {
    if (shareButton.disabled || !displayedFrame) return;
    const snapshot = displayedFrame, {code,seconds,view} = snapshot;
    const state = FormulaShare.snapshot({v:1,t:code+pad(seconds),font:view.font,numerals:view.numerals,division:view.division,ast:snapshot.ast});
    // Invalidate work for a newer second and settle the frame the user saw.
    // Capture the AST before any network await, including an ordinary null frame.
    Object.assign(displaySettings,{font:state.font,numerals:state.numerals,division:state.division});
    activeSnapshot = state;
    preview = {epoch:+FormulaShare.localDate(state.t),started:performance.now(),speed:1,paused:true};
    resetTransport();
    ++requestSerial;
    scene.getAnimations({subtree:true}).forEach(animation => animation.finish());
    applyFrame(snapshot.frame,snapshot.ast,code,seconds,false,true,view);
    showNotice('');
    clearTimeout(shareWarmTimer); shareWarmKey = JSON.stringify(state);
    const serial = ++shareSerial, preparedId = shareLinks.peek(state);
    if (preparedId) { deliverShare(FormulaShare.shortUrl(location.origin,preparedId).href,state,serial); return; }
    shareBusy = true; shareButton.disabled = true; shareButton.setAttribute('aria-busy','true');
    try {
      const id = await shareLinks.prepare(state), url = FormulaShare.shortUrl(location.origin,id).href;
      if (serial !== shareSerial) return;
      showNotice('');
      deliverShare(url,state,serial);
    } catch {
      if (serial === shareSerial) showNotice(t('shareFailed'));
    } finally {
      if (serial === shareSerial) { shareBusy = false; shareButton.removeAttribute('aria-busy'); lastVisual = ''; refresh(true); }
    }
  });
  function refresh(force = false) {
    const now = getNow(), secondKey = Math.floor(+now / 1000), seconds = now.getSeconds(), code = timeCode(now);
    const changed = secondKey !== lastSecond;
    if (!changed && !force) return;
    const previousSecond = lastSecond; lastSecond = secondKey;
    const result = cache.get(code); requestSolutions(code);
    // Spread live hour-boundary prefetches across the first 30 seconds of :59.
    // Use clock ticks instead of a timer so skipped minutes cannot leave stale work.
    if (code !== lastCode) {
      lastCode = code;
      const next = new Date(+now); next.setMinutes(next.getMinutes() + 1, 0, 0);
      const minuteStart = +now - seconds * 1000 - now.getMilliseconds();
      nextPrefetch = {code:timeCode(next), at:minuteStart + (!preview && now.getMinutes() === 59 ? Math.random() * 30000 : 0)};
    }
    if (nextPrefetch && (preview || +now >= nextPrefetch.at)) {
      requestSolutions(nextPrefetch.code);
      nextPrefetch = null;
    }
    sourceTime.setAttribute('aria-label',t('clockTime',{hours:pad(now.getHours()),minutes:pad(now.getMinutes()),seconds:pad(seconds)}));
    $('#playback').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(seconds)}`;
    const snapshot = snapshotAt(code,seconds), ast = snapshot ? snapshot.ast : result?.solutions[seconds] || null;
    renderExpression(ast, code, seconds, !result);
    prepareNext(now);
    ticks.forEach((el, i) => {
      const saved = snapshotAt(code,i), entry = saved ? saved.ast : result?.solutions[i];
      el.classList.toggle('solved', !!entry); el.classList.toggle('current', i === seconds); el.classList.toggle('past', i < seconds);
      if (i === seconds) el.setAttribute('aria-current', 'time'); else el.removeAttribute('aria-current');
      const status = t(saved ? (saved.ast ? 'formulaAvailable' : 'noFormula') : result ? (result.error ? 'dataFailed' : entry ? 'formulaAvailable' : 'noFormula') : 'loading');
      el.title = t('secondStatus',{seconds:pad(i),status});
    });
    const label = $('#state-label'); label.className = 'state-label';
    if (now.getHours() === 23 && now.getMinutes() === 59 && seconds >= 57) {
      label.textContent = t('newDayIn',{seconds:60 - seconds}); label.classList.add('counting');
    } else if (now.getHours() === 0 && now.getMinutes() === 0 && seconds === 0) {
      label.textContent = t('newDay'); label.classList.add('counting');
    } else if (snapshot) label.textContent = '';
    else if (!result) label.textContent = t('loadingData');
    else if (result.error) label.textContent = t('dataClockFallback');
    else if (!ast) { label.textContent = ''; label.classList.add('quiet'); }
    else label.textContent = '';
    if (changed && previousSecond !== null && seconds === 0 && !(preview?.paused)) {
      $('#flash').animate([{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: 0 }], { duration: reducedMotion.matches ? 200 : 1650 });
    }
  }
  function scheduleTick() {
    clearTimeout(tickTimer);
    if (preview?.paused) return;
    const now = +getNow(), speed = preview?.speed || 1;
    const delay = Math.max(12, (1000 - (now % 1000)) / speed + 3);
    tickTimer = setTimeout(() => { refresh(); scheduleTick(); }, delay);
  }

  // Audio is scheduled independently of layout. There is no replay of missed signals.
  class TimeSignal {
    ctx: AudioContext | null = null;
    master: GainNode | null = null;
    enabled: boolean;
    volume: number;
    revision = 0;
    error: string | null = null;
    scheduled = new Map<string,number>();
    voices = new Set<OscillatorNode>();
    constructor() {
      let saved: Record<string,unknown> = {};
      try { const raw: unknown = JSON.parse(localStorage.getItem('formula-clock-audio-v1') || '{}'); saved = isRecord(raw) ? raw : {}; } catch {}
      this.ctx = null; this.master = null; this.enabled = saved.enabled === true;
      this.volume = typeof saved.volume === 'number' && Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : .25;
      this.revision = 0; this.error = null; this.scheduled = new Map(); this.voices = new Set();
    }
    get ready() { return this.enabled && this.ctx?.state === 'running'; }
    save() {
      try { localStorage.setItem('formula-clock-audio-v1',JSON.stringify({enabled:this.enabled,volume:this.volume})); } catch {}
    }
    async toggle() {
      this.enabled = !this.enabled; this.revision++; this.error = null;
      this.save(); this.paint();
      if (!this.enabled) { this.cancel(); return; }
      await this.resume(true);
    }
    async resume(feedback = false) {
      if (!this.enabled) return;
      const revision = this.revision;
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error('Web Audio API is unavailable');
        if (!this.ctx) {
          this.ctx = new Audio(); this.master = this.ctx.createGain(); this.master.gain.value = this.volume * .32; this.master.connect(this.ctx.destination);
          this.ctx.addEventListener('statechange', () => {
            if (this.ctx?.state !== 'running') this.cancel();
            this.paint();
          });
        }
        // A blocked resume may remain pending until a later user gesture.
        // Keep the saved preference, and allow that gesture to call resume again.
        await this.ctx.resume();
        if (!this.enabled || revision !== this.revision) return;
        this.error = null; this.paint();
        if (feedback && this.ready) this.tone(1000, this.ctx.currentTime + .02, .15, .28);
      } catch (error) {
        if (!this.enabled || revision !== this.revision) return;
        this.error = String(error); this.paint();
      }
    }
    paint() {
      const label = t(!this.enabled ? 'soundOff' : this.ready ? 'soundOn' : this.error ? 'soundError' : 'soundPending');
      $<HTMLButtonElement>('#sound').setAttribute('aria-pressed', String(this.enabled));
      $<HTMLButtonElement>('#sound').setAttribute('aria-label', label);
      $<HTMLButtonElement>('#sound').title = t('shortcut',{label,key:'M'});
      $<SVGPathElement>('#sound-waves').setAttribute('d', this.enabled ? 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14' : 'm16 9 6 6m0-6-6 6');
    }
    setVolume(v: number) { this.volume = Math.max(0, Math.min(1, v)); this.save(); if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume * .32, this.ctx.currentTime, .035); }
    tone(frequency: number, when: number, duration: number, strength = 1) {
      if (!this.ctx || !this.master || !this.enabled) return;
      const oscillator = this.ctx.createOscillator(), gain = this.ctx.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      // Short ticks need a nearly rectangular pulse; the longer signal has a
      // brief steady onset followed by a ringing decay. Both end at duration.
      const attack = Math.min(.004,duration * .1);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(strength, when + attack);
      if (duration > .1) {
        gain.gain.setValueAtTime(strength, when + .08);
        gain.gain.exponentialRampToValueAtTime(strength * .001, when + duration - .004);
      } else gain.gain.setValueAtTime(strength, when + duration - attack);
      gain.gain.linearRampToValueAtTime(0, when + duration);
      oscillator.connect(gain); gain.connect(this.master);
      this.voices.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices.delete(oscillator); };
      oscillator.start(when); oscillator.stop(when + duration);
    }
    cancel() {
      // A briefly hidden/muted page must not repeat a tone that already began.
      // Cancelled future tones may be scheduled again; transport changes use a
      // new generation, so seeking or restarting a preview still works.
      const now = this.ctx?.currentTime || 0;
      for (const [key,when] of this.scheduled) if (when > now) this.scheduled.delete(key);
      for (const oscillator of this.voices) { try { oscillator.stop(); } catch {} }
      this.voices.clear();
    }
    poll() {
      if (!this.enabled || this.ctx?.state !== 'running' || document.hidden || preview?.paused) return;
      const now = +getNow(), speed = preview?.speed || 1, second = Math.floor(now / 1000);
      for (const boundary of [second * 1000, (second + 1) * 1000]) {
        const delay = (boundary - now) / (1000 * speed);
        if (delay < -.16 || delay > .16) continue;
        const date = new Date(boundary), sec = date.getSeconds();
        const countdown = sec % 30 >= 27, marker = sec % 10 === 0;
        // 117-style timing, with the marker extended 1.5x by listening preference.
        // These three categories never overlap at their onset.
        const frequency = marker ? 1000 : countdown ? 500 : 2000;
        const duration = marker ? 1.35 : countdown ? .05 : .007;
        const key = `${generation}:${boundary}`;
        if (this.scheduled.has(key)) continue;
        const when = this.ctx.currentTime + Math.max(0, delay);
        this.scheduled.set(key,when);
        while (this.scheduled.size > 20) this.scheduled.delete(this.scheduled.keys().next().value!);
        this.tone(frequency, when, duration, marker ? 1 : countdown ? .72 : .5);
        eventHistory.push({ type: sec === 0 ? 'minute' : marker ? 'ten-second' : countdown ? 'countdown' : 'second', time: boundary, frequency, duration });
        if (eventHistory.length > 30) eventHistory.shift();
      }
    }
  }
  const sound = new TimeSignal();
  $<HTMLInputElement>('#volume').value = String(sound.volume * 100);
  sound.paint();
  if (sound.enabled) sound.resume();
  $<HTMLButtonElement>('#sound').addEventListener('click', () => sound.toggle());
  $<HTMLInputElement>('#volume').addEventListener('input', e => sound.setVolume(Number((e.target as HTMLInputElement).value) / 100));
  $<HTMLButtonElement>('#go-live').addEventListener('click', goLive);
  $<HTMLButtonElement>('#play-pause').addEventListener('click', togglePlay);
  $<HTMLButtonElement>('#slow').addEventListener('click', toggleSlow);
  $<HTMLButtonElement>('#custom-go').addEventListener('click', () => {
    const value = $<HTMLInputElement>('#custom-time').value;
    if (!/^\d\d:\d\d(?::\d\d)?$/.test(value)) return;
    const [h,m,s = 0] = value.split(':').map(Number), d = new Date(); d.setHours(h,m,s,0);
    setPreview(d, true); settingsDialog.close();
  });
  const fullscreenButton = $<HTMLButtonElement>('#fullscreen');
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function fullscreenApi() {
    const element = document.documentElement;
    if (document.fullscreenEnabled && typeof element.requestFullscreen === 'function') {
      return {enter:() => element.requestFullscreen(),exit:() => document.exitFullscreen()};
    }
    if (document.webkitFullscreenEnabled && typeof element.webkitRequestFullscreen === 'function') {
      return {enter:() => element.webkitRequestFullscreen!(),exit:() => document.webkitExitFullscreen!()};
    }
    return null;
  }
  function paintFullscreen() {
    const active = !!fullscreenElement(), label = t(active ? 'exitFullscreen' : 'fullscreen');
    fullscreenButton.hidden = !active && !fullscreenApi();
    fullscreenButton.setAttribute('aria-pressed',String(active));
    fullscreenButton.setAttribute('aria-label',label);
    fullscreenButton.title = t('shortcut',{label,key:'F'});
    document.body.classList.toggle('fullscreen',active);
  }
  async function toggleFullscreen() {
    const api = fullscreenApi();
    if (!api) return;
    try { await (fullscreenElement() ? api.exit() : api.enter()); }
    catch { showNotice(t('fullscreenFailed')); }
    finally { paintFullscreen(); }
  }
  fullscreenButton.addEventListener('click', toggleFullscreen);
  for (const event of ['fullscreenchange','webkitfullscreenchange']) {
    document.addEventListener(event, () => { paintFullscreen(); renderResize(); });
  }
  paintFullscreen();
  document.addEventListener('keydown', e => {
    if (settingsDialog.open || licenseDialog.open || e.altKey || e.ctrlKey || e.metaKey || (e.target instanceof Element && /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(e.target.tagName))) return;
    if (e.key.toLowerCase() === 'm') sound.toggle();
    if (e.key.toLowerCase() === 'l') goLive();
    if (e.key.toLowerCase() === 'f') toggleFullscreen();
    if (e.code === 'Space' && preview) { e.preventDefault(); togglePlay(); }
  });
  function resumeSavedSound(event: MouseEvent | KeyboardEvent) {
    if (!event.isTrusted || !sound.enabled || sound.ready) return;
    const togglesSound = event.target instanceof Element && event.target.closest('#sound') && (event.type === 'click' || ('key' in event && (event.key === ' ' || event.key === 'Enter')));
    if (!togglesSound) sound.resume();
  }
  document.addEventListener('click', resumeSavedSound);
  document.addEventListener('keydown', resumeSavedSound);
  function renderResize() {
    const d = getNow(), code = timeCode(d), result = cache.get(code);
    renderExpression(result?.solutions[d.getSeconds()] || null, code, d.getSeconds(), !result, true);
  }
  new ResizeObserver(renderResize).observe(stage);
  reducedMotion.addEventListener?.('change', renderResize);
  document.addEventListener('visibilitychange', () => {
    sound.cancel();
    if (document.hidden) clearTimeout(tickTimer);
    else { lastSecond = null; refresh(true); scheduleTick(); }
  });
  if (sharedState) resetTransport();
  else { refresh(true); scheduleTick(); }
  setInterval(() => sound.poll(), 60);
  // Read-only handles for tests, with explicit transport controls for reproducible previews.
  window.FormulaClock = Object.freeze({
    preview: (time: string | Date, paused = true) => { const d = time instanceof Date ? time : new Date(time); setPreview(d, paused); },
    live: goLive, pause: togglePlay, setDisplay, setDataProvider,
    get state() { return { display:{...displaySettings}, dataRevision, dataError:cache.get(timeCode(getNow()))?.error || null, now: getNow().toISOString(), preview: !!preview, paused: preview?.paused || false, layout: latestLayout, coverage: cache.get(timeCode(getNow()))?.count, audio: eventHistory.slice(), soundEnabled: sound.enabled, soundReady: sound.ready, soundVolume: sound.volume, engineReady: typesetter.ready, engineError, typesetCacheSize: typesetter.cache.size }; },
    get digits() { return [...digitsEls]; },
    diagnostics() {
      const host = stage.getBoundingClientRect();
      return {
        build: 'r6-minimal', mathjax: typesetter.mathjax?.version || null, display:{...displaySettings},
        userAgent: navigator.userAgent, locale:ui.locale, engineError,
        typography: typesetter.typography, axisY: latestLayout?.axisY, localAxisY: latestLayout?.localAxisY,
        time: latestLayout ? `${latestLayout.code}:${pad(latestLayout.seconds)}` : null,
        glyphs: movingEls.map(el => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return { text: el.dataset.value, transform: el.getAttribute('transform'),
            x: r.x - host.x, y: r.y - host.y, width: r.width, height: r.height,
            inStage: r.width > 0 && r.height > 0 && r.right > host.left &&
              r.left < host.right && r.bottom > host.top && r.top < host.bottom,
            opacity: s.opacity, visibility: s.visibility };
        })
      };
    }
  });
})();
