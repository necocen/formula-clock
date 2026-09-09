/* TeX -> SVG layout adapter. MathJax owns typography; the clock owns animation.
 * No font files are bundled. MathJax and its font extensions load from the CDN.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const Expression = typeof module !== 'undefined' && module.exports ? require('./expression.js') : root.FormulaExpression;
  const { expressionTex, frameTex, mark, relation } = Expression;
  const PROFILES = Object.freeze({
    stix2: Object.freeze({id:'stix2', label:'STIX Two · Oldstyle', font:'mathjax-stix2', extensions:[], oldstyle:true, centerOperators:false, numericAxis:false}),
    euler: Object.freeze({id:'euler', label:'Euler', font:'mathjax-modern', extensions:['mathjax-euler'], oldstyle:false, centerOperators:true, numericAxis:true})
  });
  const matrixArray = m => [m.a, m.b, m.c, m.d, m.e, m.f];
  function finiteMatrix(m) { return matrixArray(m).every(Number.isFinite); }

  function pathBounds(scope, inverse) {
    const paths = [...(scope?.querySelectorAll('path') || [])];
    if (!paths.length) throw new Error('Missing paths during axis measurement');
    const points = [];
    for (const path of paths) {
      const ctm = path.getScreenCTM();
      if (!ctm) throw new Error('Missing path coordinates during axis measurement');
      const m = inverse.multiply(ctm), b = path.getBBox();
      for (const [x, y] of [[b.x,b.y], [b.x+b.width,b.y],
        [b.x,b.y+b.height], [b.x+b.width,b.y+b.height]]) {
        points.push(new DOMPoint(x,y).matrixTransform(m));
      }
    }
    const top = Math.min(...points.map(p => p.y));
    const bottom = Math.max(...points.map(p => p.y));
    if (!Number.isFinite(top + bottom) || bottom <= top) {
      throw new Error('Invalid glyph bounds during axis measurement');
    }
    return { top, bottom, centerY: (top + bottom) / 2 };
  }

  class Typesetter {
    constructor(profile = 'stix2') {
      if (!Object.hasOwn(PROFILES,profile)) throw new TypeError('Unknown font profile');
      this.profile = PROFILES[profile];
      this.mathjax = null;
      // Separate browsing contexts keep Euler's extension and numeric-axis
      // calibration out of the native STIX Two font. Engines are lazy
      // and cached: switching back never reloads MathJax or rebuilds digit nodes.
      this.host = document.createElement('iframe');
      this.host.className = 'math-engine-frame';
      this.host.title = `Typesetter: ${this.profile.label}`;
      this.host.tabIndex = -1;
      this.host.setAttribute('aria-hidden','true');
      document.body.append(this.host);
      this.cache = new Map();
      this.tail = Promise.resolve();
      this.ready = false;
      this.error = null;
      this.typography = null;
      this.staging = document.createElement('div');
      this.staging.className = 'math-staging';
      this.staging.setAttribute('aria-hidden', 'true');
      document.body.append(this.staging);
      this.boot = this.load();
      // The clock reads error/ready and keeps displaying ordinary time on failure.
      this.boot.catch(error => { this.error = error; });
    }
    load() {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) { this.error = error; reject(error); }
          else { this.ready = true; resolve(); }
        };
        const timer = setTimeout(() => finish(new Error('MathJax loading timed out')), 20000);
        const engineWindow = this.host.contentWindow;
        const engineDocument = this.host.contentDocument;
        const config = {
          loader: {
            load: ['[tex]/html'],
            failed: error => finish(new Error(`MathJax: ${error.message || error}`))
          },
          tex: { packages: { '[+]': ['html'] } },
          output: { font: this.profile.font, fontExtensions: this.profile.extensions.slice(), displayOverflow: 'overflow' },
          svg: { fontCache: 'none' },
          options: { enableMenu: false },
          startup: { typeset: false }
        };
        // MathJax uses realm-sensitive Array/Object checks in its option merger.
        // Construct configuration values in the engine's own realm.
        engineWindow.MathJax = engineWindow.JSON.parse(JSON.stringify(config));
        engineWindow.MathJax.loader.failed = error => finish(new Error(`MathJax: ${error.message || error}`));
        const script = engineDocument.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-svg-nofont.js';
        script.async = true;
        script.id = 'mathjax-script';
        script.onerror = () => finish(new Error('MathJax could not be downloaded'));
        script.onload = () => {
          const startup = engineWindow.MathJax?.startup?.promise;
          if (!startup) return finish(new Error('MathJax startup is unavailable'));
          startup.then(() => {
            this.mathjax = engineWindow.MathJax;
            this.identifyGlyphs();
            return this.calibrateTypography();
          }).then(() => finish(), finish);
        };
        engineDocument.head.append(script);
      });
    }
    identifyGlyphs() {
      // With fontCache:none, MathJax's pathNode keeps the Unicode code but drops
      // its size variant. Capture that identity before it is lost. The isolated
      // engine owns this prototype; never patch another font's browsing context.
      const exports = this.mathjax._?.output?.svg?.Wrapper;
      const prototype = (exports?.SvgWrapper || exports?.SVGWrapper)?.prototype;
      if (typeof prototype?.charNode !== 'function') return; // Compatibility engines keep decorations fading.
      const original = prototype.charNode;
      const font = `${this.profile.id}@${this.mathjax.version}`;
      prototype.charNode = function (variant, code, path) {
        const node = original.call(this,variant,code,path);
        this.adaptor.setAttribute(node,'data-glyph-key',`${font}:${variant}:${code}`);
        return node;
      };
    }
    async calibrateTypography() {
      // FontData.params.axis_height is MathJax's TeX math-axis parameter.
      // Calibrate ONCE from the actual font's zero, not the current time's digits.
      // Otherwise the vertical center would change whenever (say) 8 becomes 9.
      const node = await this.mathjax.tex2svgPromise(mark('probe', '0', this.profile), {
        display: true, em: 16, ex: 8, containerWidth: 100000
      });
      this.staging.append(node);
      try {
        const svg = node.querySelector('svg');
        const paths = [...(svg?.querySelectorAll('#fc-probe path') || [])];
        const params = this.mathjax.startup?.document?.outputJax?.font?.params;
        if (!svg || !paths.length || !Number.isFinite(params?.axis_height)) {
          throw new Error('MathJax math-axis calibration is unavailable');
        }
        const inverse = svg.getScreenCTM()?.inverse();
        if (!inverse) throw new Error('MathJax calibration coordinates are unavailable');
        const { top, bottom } = pathBounds(svg.querySelector('#fc-probe'), inverse);
        // SVG's math root is y-down; the font axis is y-up, in em.
        const numericAxis = -(top + bottom) / 2000;
        if (!(numericAxis > .15 && numericAxis < .55)) {
          throw new Error('Unexpected numeral metrics during math-axis calibration');
        }
        this.typography = Object.freeze({
          profile: this.profile.id, axisMode: this.profile.numericAxis ? 'numeric' : 'font',
          referenceDigit: '0', originalAxisEm: params.axis_height,
          numericAxisEm: numericAxis, zeroTop: top, zeroBottom: bottom
        });
        // Set this before typesetting any clock frame. Fractions and symmetric
        // delimiters then use the SAME axis as the vcentered arithmetic signs.
        if (this.profile.numericAxis) params.axis_height = numericAxis;
        this.typography = Object.freeze({...this.typography, axisEm:params.axis_height});
      } finally { node.remove(); }
      // A font's metric bounds and its visible ink can differ by a fraction of
      // a unit. Measure the centered '=' too, so time mode has exactly the same
      // baseline as equation mode, down to this optical/metric discrepancy.
      const axisNode = await this.mathjax.tex2svgPromise(relation(this.profile), {
        display: true, em: 16, ex: 8, containerWidth: 100000
      });
      this.staging.append(axisNode);
      try {
        const svg = axisNode.querySelector('svg');
        if (!svg) throw new Error('Equal-sign calibration failed');
        const inverse = svg.getScreenCTM()?.inverse();
        if (!inverse) throw new Error('Equal-sign calibration coordinates are unavailable');
        const equal = pathBounds(svg.querySelector('#fc-eq'), inverse);
        this.typography = Object.freeze({ ...this.typography, equalCenterY: equal.centerY });
      } finally { axisNode.remove(); }

    }
    frame(ast, code, seconds, settings = {}) {
      const tex = frameTex(ast, code, seconds, {...settings, oldstyle:this.profile.oldstyle, centerOperators:this.profile.centerOperators});
      if (this.cache.has(tex)) {
        const hit = this.cache.get(tex);
        this.cache.delete(tex); this.cache.set(tex, hit);
        return hit;
      }
      const task = this.tail.then(() => this.boot).then(() => this.convert(tex, code, seconds));
      // A failed conversion must not poison subsequent frames.
      this.tail = task.catch(() => {});
      this.cache.set(tex, task);
      task.catch(() => { if (this.cache.get(tex) === task) this.cache.delete(tex); });
      while (this.cache.size > 180) this.cache.delete(this.cache.keys().next().value);
      return task;
    }
    async convert(tex, code, seconds) {
      const node = await this.mathjax.tex2svgPromise(tex, { display: true, em: 16, ex: 8, containerWidth: 100000 });
      const svg = node.querySelector('svg');
      if (!svg || svg.querySelector('[data-mml-node="merror"]')) throw new Error('TeX typesetting failed');
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
        const symbolMarks = new Map([...svg.querySelectorAll('[id^="fc-op-"]')].map(el => {
          const [,role,attachment,ordinal] = el.id.match(/^fc-op-\d+-(add|sub|neg|mul|div|fact)-(b[1-3]|u[0-3][1-4])-(\d+)$/);
          const kind = {add:'+',sub:'−',neg:'−',mul:'×',div:'÷',fact:'!'}[role];
          return [el.id.slice(3),{kind,role,site:`${role}-${attachment}-${ordinal}`}];
        }));
        const symbolOffset = slots.length;
        slots.push(...symbolMarks.keys());
        function glyphToken(paths, metadata) {
          const {slot} = metadata;
          if (!paths.length) throw new Error(`Missing glyph ${slot}`);
          if (paths.some(path => !path.getAttribute('d')?.trim())) {
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
            const copy = path.cloneNode(true);
            copy.removeAttribute('id'); copy.removeAttribute('transform'); copy.removeAttribute('data-fc-extract');
            const pathCTM = path.getScreenCTM();
            if (!pathCTM) throw new Error(`Missing path transform ${slot}`);
            const relative = glyphInverse.multiply(pathCTM);
            const placed = local.multiply(relative);
            if (!finiteMatrix(placed)) throw new Error(`Invalid path transform ${slot}`);
            const box = path.getBBox();
            for (const [x, y] of [
              [box.x, box.y], [box.x + box.width, box.y],
              [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]
            ]) corners.push(new DOMPoint(x, y).matrixTransform(placed));
            const values = matrixArray(relative).map(v => Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(7)));
            if (values.join(',') !== '1,0,0,1,0,0') copy.setAttribute('transform', `matrix(${values.join(' ')})`);
            shape.append(copy);
          }
          // Validate the geometry we will actually display, not just the
          // original SVG. A finite matrix can still put a glyph far off-screen.
          const minX = Math.min(...corners.map(p => p.x));
          const maxX = Math.max(...corners.map(p => p.x));
          const minY = Math.min(...corners.map(p => p.y));
          const maxY = Math.max(...corners.map(p => p.y));
          const slack = 100; // 0.1 em allows ordinary glyph overhangs.
          if (!(maxX > minX && maxY > minY) ||
              maxX < v.x - slack || minX > v.x + v.width + slack ||
              maxY < v.y - slack || minY > v.y + v.height + slack) {
            throw new Error(`Glyph outside SVG viewBox ${slot}`);
          }
          const center = new DOMPoint((minX+maxX)/2,(minY+maxY)/2).matrixTransform(new DOMMatrix(matrixArray(local)).inverse());
          return { ...metadata, matrix: matrixArray(local), shape, inkCenter:[center.x,center.y] };
        }
        const tokens = slots.map((slot, i) => {
          const symbol = symbolMarks.get(slot);
          return glyphToken([...svg.querySelectorAll(`#fc-${slot} path`)], {
            slot, text:symbol ? symbol.kind : slot === 'eq' ? '=' : i < 4 ? code[i] : secondsText[i-4], font:this.profile.id, ...symbol
          });
        });
        const structures = [];
        function ruleToken(rect, metadata) {
          const box = rect.getBBox(), ctm = rect.getScreenCTM();
          if (!ctm || !(box.width > 0 && box.height > 0)) throw new Error('Invalid mathematical rule');
          // A unit rectangle makes width and thickness independent coordinates.
          // Its shape never changes while the six matrix components interpolate.
          const local = new DOMMatrix(matrixArray(inverse.multiply(ctm))).multiply(new DOMMatrix([box.width,0,0,box.height,box.x,box.y]));
          if (!finiteMatrix(local)) throw new Error('Non-finite rule coordinates');
          const shape = document.createElementNS(NS,'g'), unit = document.createElementNS(NS,'rect');
          unit.setAttribute('width','1'); unit.setAttribute('height','1'); shape.append(unit);
          rect.setAttribute('data-fc-extract','');
          return {...metadata,slot:metadata.site,text:metadata.kind,matrix:matrixArray(local),shape};
        }
        const coreOf = (tag,name) => tag.matches(`[data-mml-node="${name}"]`) ? tag : tag.querySelector(`[data-mml-node="${name}"]`);
        const ownRules = core => [...core.querySelectorAll('rect')].filter(rect => rect.closest('[data-mml-node="mfrac"],[data-mml-node="msqrt"]') === core);
        const singleGlyph = path => path?.hasAttribute('data-glyph-key') && path.closest('[data-mml-node="mo"]')?.querySelectorAll('path').length === 1;
        function takeGlyph(path, metadata) {
          structures.push(glyphToken([path],{...metadata,slot:metadata.site,text:metadata.kind}));
          path.setAttribute('data-fc-extract','');
        }
        for (const tag of svg.querySelectorAll('[id^="fc-struct-"]')) {
          const [,role,attachment,ordinal] = tag.id.match(/^fc-struct-(frac|root|paren)-(b[1-3]|u[0-3][1-4])-(\d+)$/);
          const site = `${role}-${attachment}-${ordinal}`;
          if (role === 'frac') {
            const core = coreOf(tag,'mfrac'), rules = core ? ownRules(core) : [];
            if (rules.length === 1) structures.push(ruleToken(rules[0],{kind:'fraction-rule',site,glyphKey:'rule'}));
          } else if (role === 'root') {
            const core = coreOf(tag,'msqrt');
            if (!core) continue;
            const paths = [...core.querySelectorAll('path[data-c="221A"]')].filter(path => path.closest('[data-mml-node="msqrt"]') === core);
            const rules = ownRules(core), path = paths[0];
            // An assembled radical stays in the fading layer. For a single
            // glyph, the sign and overbar share an identity and timing so their
            // junction remains connected, including when a size variant changes.
            if (paths.length !== 1 || !singleGlyph(path) || rules.length !== 1) continue;
            const glyphKey = path.getAttribute('data-glyph-key');
            takeGlyph(path,{kind:'root-sign',site,glyphKey});
            structures.push(ruleToken(rules[0],{kind:'root-rule',site,glyphKey}));
          } else {
            const paths = [...tag.querySelectorAll('path[data-c="28"],path[data-c="29"]')].filter(path => path.closest('[id^="fc-struct-"]') === tag);
            for (const path of paths) if (singleGlyph(path)) {
              const kind = path.getAttribute('data-c') === '28' ? 'paren-left' : 'paren-right';
              takeGlyph(path,{kind,site,glyphKey:path.getAttribute('data-glyph-key')});
            }
          }
        }
        // Anchor equations by the actual equal-sign ink, not by the full SVG's
        // height. In time mode use the same mathematical axis (there is no '=').
        let axisY = this.typography.equalCenterY;
        if (equality) axisY = pathBounds(equality, inverse).centerY;
        if (!Number.isFinite(axisY)) throw new Error('Invalid mathematical axis');
        const decorations = document.createElementNS(NS, 'g');
        decorations.setAttribute('fill', 'currentColor');
        decorations.setAttribute('stroke', 'currentColor');
        decorations.setAttribute('stroke-width', '0');
        for (const child of svg.children) decorations.append(child.cloneNode(true));
        for (const slot of slots) decorations.querySelector(`#fc-${slot}`)?.remove();
        decorations.querySelectorAll('[data-fc-extract]').forEach(el => el.remove());
        // cssId is only a temporary typesetting marker, never an on-screen id.
        decorations.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        return { tex, viewBox, tokens:tokens.slice(0,6), equality:equality ? tokens[6] : null, symbols:[...tokens.slice(symbolOffset),...structures], decorations, axisY, typography: this.typography, font: this.profile.id };
      } finally { node.remove(); }
    }
  }
  const api = { Typesetter, PROFILES, expressionTex, frameTex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormulaTypesetter = Object.freeze(api);
})(typeof window === 'undefined' ? globalThis : window);
