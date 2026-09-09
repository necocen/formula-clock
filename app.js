/* Formula Clock: persistent digit objects, separate typography and data delivery. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const stage = $('#stage'), digitsEls = [...stage.querySelectorAll('.digit')];
  const sourceTime = $('#source-time'), sourceEls = [...sourceTime.querySelectorAll('.source-digit')];
  const sourceColons = [...sourceTime.querySelectorAll('.colon')];
  const cache = new Map(), pending = new Map();
  const settingsDialog = $('#settings'), settingsButton = $('#settings-open');
  const licenseDialog = $('#licenses');
  function setupDialog(dialog, opener, closeButton) {
    opener.addEventListener('click', () => {
      dialog.showModal(); closeButton.focus({preventScroll:true}); dialog.scrollTop = 0;
    });
    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => opener.focus({preventScroll:true}));
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button,input,select,summary,a[href]')]
        .filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    // Dragging out from a control must not count as a backdrop click.
    let backdropPointer = false;
    function outsideDialog(event) {
      const r = dialog.getBoundingClientRect();
      return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    }
    dialog.addEventListener('pointerdown', event => { backdropPointer = outsideDialog(event); });
    dialog.addEventListener('click', event => {
      if (backdropPointer && outsideDialog(event)) dialog.close();
      backdropPointer = false;
    });
  }
  setupDialog(settingsDialog,settingsButton,$('#settings-close'));
  setupDialog(licenseDialog,$('#licenses-open'),$('#licenses-close'));
  const {normalizeMinute, InlineProvider, TableProvider} = FormulaData;
  const defaultProvider = () => new TableProvider(async () => {
    const embedded = document.querySelector('#clock-data');
    if (!embedded) throw new Error('No embedded formula table or custom provider');
    return FormulaData.loadEmbedded(embedded);
  });
  const initialProvider = window.FORMULA_CLOCK_CONFIG?.provider || defaultProvider();
  let provider = initialProvider;
  let dataRevision = 0;
  function savedDisplay() {
    try { return JSON.parse(localStorage.getItem('formula-clock-display-v2') || '{}') || {}; } catch { return {}; }
  }
  const saved = savedDisplay();
  let displaySettings = {
    font: Object.hasOwn(FormulaTypesetter.PROFILES,saved.font) ? saved.font : 'stix2',
    division: ['fraction','inline'].includes(saved.division) ? saved.division : 'fraction',
    symbolMotion: saved.symbolMotion === true,
    structureMotion: saved.structureMotion === true,
    symbolMorph: saved.symbolMorph === true
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pad = n => String(n).padStart(2, '0');
  const timeCode = d => pad(d.getHours()) + pad(d.getMinutes());
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const b = document.createElement('button'); b.className = 'tick' + (i % 5 === 0 ? ' major' : '');
    b.title = `${pad(i)}秒を表示`; b.setAttribute('aria-label', `${i}秒をプレビュー`);
    b.addEventListener('click', () => { const d = getNow(); d.setSeconds(i, 0); setPreview(d, true); });
    $('#ruler').append(b); return b;
  });
  function requestSolutions(code) {
    const existing = cache.get(code);
    if (pending.has(code) || (existing && (!existing.error || Date.now() < existing.retryAfter))) return;
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
      while (cache.size > 10) cache.delete(cache.keys().next().value);
      if (timeCode(getNow()) === code) refresh(true);
    });
  }
  function setDataProvider(next) {
    if (!next || typeof next.getMinute !== 'function') throw new TypeError('Provider needs getMinute(hhmm, {signal})');
    dataRevision++;
    pending.forEach(controller => controller.abort()); pending.clear(); cache.clear();
    provider = next; lastVisual = ''; lastCode = null; ++requestSerial;
    refresh(true);
  }

  // MathJax computes the layout; persistent digits and equality display it.
  // The four HHMM objects are never recreated, including ordinary clock mode.
  const engines = new Map(), clockFaces = new Map();
  function engineFor(font) {
    if (!engines.has(font)) {
      const engine = new FormulaTypesetter.Typesetter(font);
      engines.set(font,engine);
      engine.clockFace().then(face => {
        clockFaces.set(font,face);
        if (displaySettings.font === font) { lastVisual=''; refresh(true); }
      }).catch(error => console.warn('[Formula Clock] Small clock font unavailable.',error));
      engine.boot.then(() => {
        if (displaySettings.font === font) { lastVisual=''; refresh(true); }
      }).catch(error => {
        if (displaySettings.font === font) { engineError=String(error); lastVisual=''; refresh(true); }
      });
    }
    return engines.get(font);
  }
  let typesetter = engineFor(displaySettings.font);
  async function setDisplay(changes) {
    const next = {...displaySettings,...changes};
    if (!Object.hasOwn(FormulaTypesetter.PROFILES,next.font) || !['fraction','inline'].includes(next.division) || ['symbolMotion','structureMotion','symbolMorph'].some(key=>typeof next[key] !== 'boolean')) throw new TypeError('Invalid display options');
    displaySettings = {font:next.font,division:next.division,symbolMotion:next.symbolMotion,structureMotion:next.structureMotion,symbolMorph:next.symbolMorph};
    $('#symbol-motion').checked = next.symbolMotion;
    $('#structure-motion').checked = next.structureMotion;
    $('#symbol-morph').checked = next.symbolMorph;
    $('#font-choice').value = next.font; $('#division-choice').value = next.division;
    try {localStorage.setItem('formula-clock-display-v2',JSON.stringify(displaySettings));} catch {}
    typesetter = engineFor(next.font); engineError=null; lastVisual='';
    refresh(true);
    await typesetter.boot;
  }
  $('#symbol-motion').checked = displaySettings.symbolMotion;
  $('#symbol-motion').addEventListener('change',e=>{setDisplay({symbolMotion:e.target.checked}).catch(()=>{});});
  $('#structure-motion').checked = displaySettings.structureMotion;
  $('#structure-motion').addEventListener('change',e=>{setDisplay({structureMotion:e.target.checked}).catch(()=>{});});
  $('#symbol-morph').checked = displaySettings.symbolMorph;
  $('#symbol-morph').addEventListener('change',e=>{setDisplay({symbolMorph:e.target.checked}).catch(()=>{});});
  $('#font-choice').value = displaySettings.font;
  $('#division-choice').value = displaySettings.division;
  $('#font-choice').addEventListener('change',e=>{setDisplay({font:e.target.value}).catch(()=>{});});
  $('#division-choice').addEventListener('change',e=>{setDisplay({division:e.target.value}).catch(()=>{});});
  const scene = $('#math-scene'), notationRoot = $('#notation-root'), equalSign = $('#equal-sign');
  const operatorRoot = $('#operator-root'), symbolRecords = new Set();
  const secondsEls = [...scene.querySelectorAll('.answer-digit')];
  const movingEls = [...digitsEls, ...secondsEls];
  const plainTime = $('#plain-time');
  const movement = new Map();
  const morphs = new Map();
  let notation = null, lastVisual = '', firstFrame = true, latestLayout = null;
  let requestSerial = 0, animationId = 0, engineError = null;
  const reportedRenderErrors = new Set();
  const mathNS = 'http://www.w3.org/2000/svg';
  const DURATION = 680;
  const MORPH_DURATION = 320;
  const matrixString = a => `matrix(${a.map(n => n.toFixed(7)).join(' ')})`;
  const ease = t => 1 - Math.pow(1 - t, 4);
  function matrixAt(record, now) {
    const p = Math.min(1, Math.max(0, (now - record.started) / DURATION));
    const k = ease(p);
    return record.to.map((v, i) => record.from[i] + (v - record.from[i]) * k);
  }
  function animatePositions(now) {
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
  function setPosition(el, target, animated, now) {
    const old = movement.get(el);
    const from = old ? matrixAt(old, now) : target;
    movement.set(el, { from: animated ? from : target, to: target, started: animated ? now : now - DURATION });
    el.setAttribute('transform', matrixString(animated ? from : target));
    if (animated && !animationId) animationId = requestAnimationFrame(animatePositions);
  }
  function fadeIn(el, duration, delayed = false) {
    if (reducedMotion.matches) return;
    el.animate(delayed ? [{ opacity: 0 }, { opacity: 0, offset: .18 }, { opacity: 1 }] : [{ opacity: .15 }, { opacity: 1 }], { duration, easing: 'ease-out' });
  }
  function morphStateAt(record,now) {
    const p = Math.min(1,Math.max(0,(now-record.started)/MORPH_DURATION));
    const k = p*p*(3-2*p), mix = (a,b)=>a+(b-a)*k;
    return {angle:mix(record.from.angle,record.to.angle),
      weights:Object.fromEntries(Object.keys(record.parts).map(kind=>[kind,mix(record.from.weights[kind] || 0,kind===record.target?1:0)])),
      center:record.from.center.map((v,i)=>mix(v,record.to.center[i]))};
  }
  function paintMorph(record,now) {
    const state=morphStateAt(record,now);
    for (const [kind,part] of Object.entries(record.parts)) {
      const angle=state.angle-(kind==='×'?45:0);
      part.group.setAttribute('transform',`translate(${state.center.join(' ')}) rotate(${angle}) translate(${-part.center[0]} ${-part.center[1]})`);
      part.group.setAttribute('opacity',state.weights[kind]);
    }
    return state;
  }
  function finishMorph(el) {
    const record=morphs.get(el);
    if (!record) return;
    el.replaceChildren(record.parts[record.target].shape);
    el.removeAttribute('data-morphing');morphs.delete(el);
  }
  function startMorph(el,oldToken,token,now) {
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
      parts[glyph.kind]={group,shape,center:glyph.inkCenter};
    }
    // Preserve every visible contribution when interrupted by a third sign.
    // One layer per arithmetic glyph bounds even rapid switching to four;
    // completion restores the exact native destination glyph.
    const record={parts,from,to:{angle:token.kind==='×'?45:0,center:token.inkCenter},started:now,target:token.kind};
    el.replaceChildren(...Object.values(parts).map(part=>part.group));
    el.dataset.morphing='true';el.dataset.value=token.text;el._shapeKey=token.shape.innerHTML;
    morphs.set(el,record);paintMorph(record,now);
  }
  function updateSymbols(tokens,animated,placeToken,morphEnabled) {
    const previous=[...symbolRecords];
    const old=previous.map(record=>({...record.token,exiting:record.exiting}));
    const matches=FormulaSymbols.match(old,tokens,{morph:animated && morphEnabled}),used=new Set();
    tokens.forEach((token,i)=>{
      let record=previous[matches[i]];
      if(!record) {
        const el=document.createElementNS(mathNS,'g');
        el.classList.add('moving-symbol');operatorRoot.append(el);
        record={el};symbolRecords.add(record);
      } else if(record.animation) {
        const opacity=getComputedStyle(record.el).opacity;
        record.animation.cancel();record.animation=null;
        if(animated)record.el.animate([{opacity},{opacity:1}],{duration:180});
      }
      const oldToken=record.token;
      used.add(record);record.exiting=false;record.token=token;
      record.el.dataset.kind=token.kind;
      record.el.dataset.site=token.site;
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
  function plainFallback(code, seconds, reason) {
    const full = `${code.slice(0,2)}:${code.slice(2)}:${pad(seconds)}`;
    [...plainTime.querySelectorAll('span')].forEach((el, i) => { el.textContent = full[i]; });
    plainTime.hidden = false; scene.style.visibility = 'hidden';
    sourceTime.hidden = true;
    stage.classList.add('resting');
    stage.setAttribute('aria-label', full);
    $('#engine-status').textContent = reason;
  }
  function renderSourceTime(font, code, seconds, visible) {
    const face = clockFaces.get(font);
    if (face) {
      const colon = face.glyphs[':'];
      // Six equal 500-unit cells keep every digit stationary, even with oldstyle
      // or proportional glyphs. Fixed 450-unit separators match ordinary clock spacing.
      const centers = [400,900,1850,2350,3300,3800];
      const baseline = 550 - (colon.bounds.y + colon.bounds.h / 2);
      function place(el, text, center) {
        const token = face.glyphs[text];
        if (el.dataset.font === font && el.dataset.value === text) return;
        const matrix = token.matrix.slice();
        matrix[4] += center - (token.bounds.x + token.bounds.w / 2);
        matrix[5] += baseline;
        el.replaceChildren(token.shape.cloneNode(true));
        el.setAttribute('transform',matrixString(matrix));
        el.dataset.font = font; el.dataset.value = text;
      }
      const text = code + pad(seconds);
      sourceEls.forEach((el,i) => place(el,text[i],centers[i]));
      sourceColons.forEach((el,i) => place(el,':',1375 + i * 1450));
      sourceTime.dataset.font = font;
    }
    sourceTime.hidden = !visible || !face;
  }
  function applyFrame(frame, ast, code, seconds, loading, instant, view) {
    const W = stage.clientWidth, H = stage.clientHeight, b = frame.viewBox;
    const axis = H / 2, margin = 15;
    const above = Math.max(1, frame.axisY - b.y);
    const below = Math.max(1, b.y + b.h - frame.axisY);
    // Fit each side of a fixed axis independently. A tall numerator may shrink
    // the equation, but must never push the equal sign or normal digits down.
    const scale = Math.min(112 / 1000, (W - 24) / b.w,
      (axis - margin) / above, (H - margin - axis) / below);
    const x = (W - b.w * scale) / 2 - b.x * scale;
    const y = axis - frame.axisY * scale;
    const fit = new DOMMatrix([scale, 0, 0, scale, x, y]);
    const animated = !instant && !firstFrame && !reducedMotion.matches;
    // One clock for the entire frame keeps a radical and its rule joined, even
    // if DOM work between their updates takes a few milliseconds.
    const positionTime = performance.now();
    const items = [];
    function placeToken(token, el, morphFrom = null) {
      if (morphFrom && animated && view.symbolMorph) startMorph(el,morphFrom,token,positionTime);
      else if (!animated || !view.symbolMorph || el._shapeKey !== token.shape.innerHTML || el.dataset.value !== token.text) finishMorph(el);
      // A preference change may interrupt an existing fade on a reused glyph.
      if (!animated) el.getAnimations({subtree:true}).forEach(animation => animation.cancel());
      // Preserve the glyph's child nodes too until this clock position changes digit.
      if (el.dataset.value !== token.text || !el.firstChild || el._shapeKey !== token.shape.innerHTML) {
        el.replaceChildren(token.shape.cloneNode(true));
        if (animated) fadeIn(el.firstChild, 350);
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
    const content = frame.decorations.cloneNode(true);
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
    renderSourceTime(frame.font,code,seconds,!!ast && !loading);
    $('#engine-status').textContent = `MathJax · ${FormulaTypesetter.PROFILES[frame.font].label} / SVG`;
    stage.setAttribute('aria-label', ast ? `${code.slice(0,2)}時${code.slice(2)}分${seconds}秒。${FormulaExpression.plain(ast, code)} = ${seconds}` : `${code.slice(0,2)}時${code.slice(2)}分${seconds}秒`);
    latestLayout = { display:{...view}, ast, code, seconds, mode: ast ? 'formula' : 'time', tex: frame.tex, items, width: b.w * scale, height: b.h * scale, viewBox: { ...b }, fontSize: scale * 1000, axisY: axis, localAxisY: frame.axisY, fit: [scale,0,0,scale,x,y], typography: frame.typography };
    firstFrame = false;
  }
  function renderExpression(ast, code, seconds, loading, instant = false) {
    const engine = typesetter, view = {...displaySettings};
    const key = `${view.font}:${view.division}:${view.symbolMotion}:${view.structureMotion}:${view.symbolMorph}:${JSON.stringify(ast)}:${code}:${seconds}:${stage.clientWidth}:${stage.clientHeight}:${loading}`;
    if (lastVisual === key && !instant) return;
    lastVisual = key;
    const serial = ++requestSerial;
    if (!engine.ready) plainFallback(code,seconds,engine.error ? '組版を読み込めなかった。通常の時計を表示中。' : `MathJax · ${engine.profile.label} を読み込み中`);
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
          $('#engine-status').textContent = 'この式を組版できなかった。通常の時計を表示中。';
          return;
        } catch { /* Ordinary text fallback below. */ }
      }
      plainFallback(code, seconds, '組版を読み込めなかった。通常の時計を表示中。');
    });
  }
  // Warm only the immediately upcoming frames; do not queue a minute of work
  // ahead of interactive previews. The LRU retains recent typesetting results.
  function prepareNext(now) {
    if (!typesetter.ready || preview?.paused || document.hidden) return;
    for (const offset of [1, 2]) {
      const next = new Date(+now + offset * 1000), code = timeCode(next), result = cache.get(code);
      if (result) typesetter.frame(result.solutions[next.getSeconds()] || null, code, next.getSeconds(), displaySettings).catch(() => {});
    }
  }
  // Transport time is anchored to the wall clock (live) or a monotonic clock (preview).
  let preview = null, generation = 0, lastSecond = null, lastCode = null, tickTimer = null;
  let nextPrefetch = null;
  const eventHistory = [];
  function getNow() { return preview ? new Date(preview.epoch + (preview.paused ? 0 : performance.now() - preview.started) * preview.speed) : new Date(); }
  function setPreview(date, paused = false) {
    if (!(date instanceof Date) || !Number.isFinite(+date)) return;
    preview = { epoch: +date, started: performance.now(), speed: 1, paused };
    resetTransport();
  }
  function resetTransport() {
    generation++; lastSecond = null; sound.cancel();
    document.body.classList.toggle('preview-mode', !!preview);
    $('#transport').hidden = !preview;
    $('#play-pause').textContent = preview?.paused ? '再生' : '一時停止';
    $('#slow').setAttribute('aria-pressed', String(!!preview && preview.speed < 1));
    refresh(true); scheduleTick();
  }
  function goLive() { preview = null; resetTransport(); }
  function togglePlay() {
    if (!preview) return;
    preview = { ...preview, epoch: +getNow(), started: performance.now(), paused: !preview.paused };
    resetTransport();
  }
  function toggleSlow() {
    if (!preview) return;
    preview = { ...preview, epoch: +getNow(), started: performance.now(), speed: preview.speed === 1 ? .5 : 1 };
    resetTransport();
  }
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
    sourceTime.setAttribute('aria-label', `${pad(now.getHours())}時${pad(now.getMinutes())}分${pad(seconds)}秒`);
    $('#playback').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(seconds)}`;
    const ast = result?.solutions[seconds] || null;
    renderExpression(ast, code, seconds, !result);
    prepareNext(now);
    ticks.forEach((el, i) => {
      el.classList.toggle('solved', !!result?.solutions[i]); el.classList.toggle('current', i === seconds); el.classList.toggle('past', i < seconds);
      if (i === seconds) el.setAttribute('aria-current', 'time'); else el.removeAttribute('aria-current');
      el.title = `${pad(i)}秒 · ${result ? (result.error ? 'データ取得失敗' : result.solutions[i] ? '式あり' : '式なし') : '読込中'}`;
    });
    const label = $('#state-label'); label.className = 'state-label';
    if (now.getHours() === 23 && now.getMinutes() === 59 && seconds >= 57) {
      label.textContent = `新しい一日まで、${60 - seconds}`; label.classList.add('counting');
    } else if (now.getHours() === 0 && now.getMinutes() === 0 && seconds === 0) {
      label.textContent = '新しい一日。'; label.classList.add('counting');
    } else if (!result) label.textContent = '式データを読み込み中。';
    else if (result.error) label.textContent = '式データを読み込めなかった。通常の時計を表示中。';
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
    constructor() { this.ctx = null; this.master = null; this.enabled = false; this.volume = .25; this.scheduled = new Set(); this.voices = new Set(); }
    async toggle() {
      if (this.enabled) { this.enabled = false; this.cancel(); this.paint(); return; }
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) throw new Error('Web Audio API is unavailable');
        if (!this.ctx) { this.ctx = new Audio(); this.master = this.ctx.createGain(); this.master.gain.value = this.volume * .32; this.master.connect(this.ctx.destination); }
        await this.ctx.resume();
        if (this.ctx.state !== 'running') throw new Error('Audio could not be enabled');
        this.enabled = true; this.paint(); this.tone(880, this.ctx.currentTime + .02, .15, .28);
      } catch (error) { console.error(error); this.enabled = false; this.paint(); $('#sound').setAttribute('aria-label','音を有効化できない'); $('#sound').title = '音を有効化できない'; }
    }
    paint() {
      $('#sound').setAttribute('aria-pressed', String(this.enabled));
      $('#sound').setAttribute('aria-label', this.enabled ? '時報 オン' : '時報 オフ');
      $('#sound').title = `${this.enabled ? '時報 オン' : '時報 オフ'}（M）`;
      $('#sound-waves').setAttribute('d', this.enabled ? 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14' : 'm16 9 6 6m0-6-6 6');
    }
    setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.setTargetAtTime(this.volume * .32, this.ctx.currentTime, .035); }
    tone(frequency, when, duration, strength = 1) {
      if (!this.ctx || !this.enabled) return;
      const oscillator = this.ctx.createOscillator(), gain = this.ctx.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(strength, when + .008);
      gain.gain.exponentialRampToValueAtTime(.001, when + duration);
      gain.gain.linearRampToValueAtTime(0, when + duration + .025);
      oscillator.connect(gain); gain.connect(this.master);
      this.voices.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices.delete(oscillator); };
      oscillator.start(when); oscillator.stop(when + duration + .04);
    }
    cancel() {
      this.scheduled.clear();
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
        const countdown = date.getHours() === 23 && date.getMinutes() === 59 && sec >= 57;
        if (sec !== 0 && !countdown) continue;
        const key = `${generation}:${boundary}`;
        if (this.scheduled.has(key)) continue;
        this.scheduled.add(key);
        while (this.scheduled.size > 20) this.scheduled.delete(this.scheduled.values().next().value);
        this.tone(countdown ? 440 : 880, this.ctx.currentTime + Math.max(0, delay), countdown ? .13 : 1.5, countdown ? .72 : 1);
        eventHistory.push({ type: countdown ? 'countdown' : 'minute', time: boundary, frequency: countdown ? 440 : 880 });
        if (eventHistory.length > 30) eventHistory.shift();
      }
    }
  }
  const sound = new TimeSignal();
  $('#sound').addEventListener('click', () => sound.toggle());
  $('#volume').addEventListener('input', e => sound.setVolume(Number(e.target.value) / 100));
  $('#go-live').addEventListener('click', goLive);
  $('#play-pause').addEventListener('click', togglePlay);
  $('#slow').addEventListener('click', toggleSlow);
  $('#custom-go').addEventListener('click', () => {
    const value = $('#custom-time').value;
    if (!/^\d\d:\d\d(?::\d\d)?$/.test(value)) return;
    const [h,m,s = 0] = value.split(':').map(Number), d = new Date(); d.setHours(h,m,s,0);
    setPreview(d, true); settingsDialog.close();
  });
  $('#import-data').addEventListener('click',()=>$('#data-file').click());
  $('#data-file').addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file)return;
    try {
      if(file.size>64*1024*1024)throw new Error('JSON is larger than 64 MB');
      const input=JSON.parse(await file.text());
      const table=typeof input?.hhmm === 'string'
        ? {schema:input.schema,minutes:{[input.hhmm]:normalizeMinute(input,input.hhmm).seconds}}
        : input;
      const next=new InlineProvider(table);
      // Validate the full imported file before replacing the active provider.
      for(const hhmm of Object.keys(table.minutes)) normalizeMinute({schema:table.schema,hhmm,seconds:table.minutes[hhmm]},hhmm);
      setDataProvider(next);
      $('#data-status').textContent=`${file.name} · ${Object.keys(table.minutes).length}分を読み込んだ。`;
    } catch(error){$('#data-status').textContent=`読込失敗：${error.message}`;}
    e.target.value='';
  });
  $('#restore-data').addEventListener('click',()=>{setDataProvider(initialProvider);$('#data-status').textContent='起動時のデータに戻した。';});
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else { document.body.classList.toggle('fullscreen'); renderResize(); }
    } catch { document.body.classList.toggle('fullscreen'); renderResize(); }
  }
  $('#fullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => { document.body.classList.toggle('fullscreen', !!document.fullscreenElement); renderResize(); });
  document.addEventListener('keydown', e => {
    if (settingsDialog.open || licenseDialog.open || e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(e.target.tagName)) return;
    if (e.key.toLowerCase() === 'm') sound.toggle();
    if (e.key.toLowerCase() === 'l') goLive();
    if (e.key.toLowerCase() === 'f') toggleFullscreen();
    if (e.code === 'Space' && preview) { e.preventDefault(); togglePlay(); }
  });
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
  refresh(true); scheduleTick();
  setInterval(() => sound.poll(), 60);
  // Read-only handles for tests, with explicit transport controls for reproducible previews.
  window.FormulaClock = Object.freeze({
    preview: (time, paused = true) => { const d = time instanceof Date ? time : new Date(time); setPreview(d, paused); },
    live: goLive, pause: togglePlay, setDisplay, setDataProvider,
    get state() { return { display:{...displaySettings}, dataRevision, dataError:cache.get(timeCode(getNow()))?.error || null, now: getNow().toISOString(), preview: !!preview, paused: preview?.paused || false, layout: latestLayout, coverage: cache.get(timeCode(getNow()))?.count, audio: eventHistory.slice(), soundEnabled: sound.enabled, engineReady: typesetter.ready, engineError, typesetCacheSize: typesetter.cache.size }; },
    get digits() { return [...digitsEls]; },
    diagnostics() {
      const host = stage.getBoundingClientRect();
      return {
        build: 'r6-minimal', mathjax: typesetter.mathjax?.version || null, display:{...displaySettings},
        userAgent: navigator.userAgent, engineError,
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
