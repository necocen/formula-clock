/* The public expression format and its presentation-independent serializer.
 * Leaves reference HHMM positions [i,j); they never contain numeric values.
 */
(function (root) {
  'use strict';
  const UNARY = new Set(['neg', 'sqrt', 'fact']);
  const BINARY = new Set(['add', 'sub', 'mul', 'div', 'pow']);
  const validCode = code => typeof code === 'string' && /^(?:[01]\d|2[0-3])[0-5]\d$/.test(code);
  function assertCode(code) { if (!validCode(code)) throw new TypeError('HHMM must be a 24-hour time (0000–2359)'); }

  // Return a new, bounded, immutable tree. No getters/extra keys survive this boundary.
  function validateAst(ast, code) {
    assertCode(code);
    if (ast === null) return null;
    let nodes = 0; const slots = [], active = new Set();
    function visit(x, depth) {
      if (!x || typeof x !== 'object' || Array.isArray(x) || ++nodes > 96 || depth > 24 || active.has(x)) {
        throw new TypeError('Invalid or excessively deep expression tree');
      }
      active.add(x); let out;
      if (x.op === 'lit') {
        const {i, j} = x;
        if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j > 4 || i >= j) throw new TypeError('Invalid digit interval');
        if (j - i > 1 && code[i] === '0') throw new TypeError('Leading zero in a concatenated number');
        for (let k = i; k < j; k++) slots.push(k);
        out = {op:'lit', i, j};
      } else if (UNARY.has(x.op)) out = {op:x.op, a:visit(x.a, depth + 1)};
      else if (BINARY.has(x.op)) out = {op:x.op, a:visit(x.a, depth + 1), b:visit(x.b, depth + 1)};
      else throw new TypeError(`Unknown operation: ${String(x.op)}`);
      const allowed = Object.keys(out);
      if (Object.keys(x).some(key => !allowed.includes(key))) throw new TypeError(`Unexpected expression field (${x.op})`);
      active.delete(x); return Object.freeze(out);
    }
    const result = visit(ast, 0);
    if (slots.join(',') !== '0,1,2,3') throw new TypeError('Use each HHMM position exactly once, in order');
    return result;
  }

  function options(value = {}) {
    const division = value.division ?? 'fraction';
    if (!['fraction','inline'].includes(division)) throw new TypeError('Unknown division style');
    return { division, oldstyle: !!value.oldstyle, centerOperators: value.centerOperators !== false, symbolMotion: value.symbolMotion === true, structureMotion: value.structureMotion === true, symbolMorph: value.symbolMorph === true };
  }
  function mark(slot, digit, opt) {
    const glyph = opt.oldstyle ? `{\\oldstyle ${digit}}` : digit;
    return `\\cssId{fc-${slot}}{${glyph}}`;
  }
  const parens = text => `\\left(${text}\\right)`;
  const center = (symbol, opt) => opt.centerOperators ? `\\vcenter{${symbol}}` : symbol;
  const binary = (symbol, opt) => opt.centerOperators ? `\\mathbin{${center(symbol,opt)}}` : symbol;
  const negative = opt => opt.centerOperators ? '\\mathord{\\vcenter{-}}' : '-';
  const relation = opt => `\\mathrel{\\cssId{fc-eq}{${center('=',opt)}}}`;

  // Precedence is a property of the PRESENTATION. A fraction is a visual group;
  // an obelus is a left-associative infix operator with multiplication's priority.
  function precedence(ast, opt) {
    if (ast.op === 'lit' || ast.op === 'sqrt' || (ast.op === 'div' && opt.division === 'fraction')) return 60;
    return {add:10, sub:10, mul:20, div:20, neg:30, pow:40, fact:50}[ast.op];
  }
  function expressionTex(ast, code, settings = {}) {
    assertCode(code);
    const opt = options(settings);
    let symbolId = 0;
    const siteCounts = new Map();
    function interval(a) {
      if (a.op === 'lit') return [a.i,a.j];
      const left = interval(a.a);
      return [left[0],a.b ? interval(a.b)[1] : left[1]];
    }
    function structure(role, a, tex) {
      if (!opt.structureMotion) return tex;
      const [i,j] = interval(a);
      const site = `${role}-${role === 'frac' ? `b${interval(a.a)[1]}` : `u${i}${j}`}`;
      const ordinal = siteCounts.get(site) || 0;
      siteCounts.set(site,ordinal+1);
      return `\\cssId{fc-struct-${site}-${ordinal}}{${tex}}`;
    }
    const enclose = (a,tex) => structure('paren',a,parens(tex));
    function symbol(a, glyph, texClass) {
      if (!opt.symbolMotion && !(opt.symbolMorph && ['add','sub','mul','div'].includes(a.op))) {
        if (a.op === 'neg') return negative(opt);
        return a.op === 'fact' ? glyph : binary(glyph,opt);
      }
      const [i,j] = interval(a);
      // Binary operators belong to a gap between HHMM slots. Unary operators
      // belong to their operand's slot interval, with an ordinal for nesting.
      const attachment = a.b ? `b${interval(a.a)[1]}` : `u${i}${j}`;
      const site = `${a.op}-${attachment}`;
      const ordinal = siteCounts.get(site) || 0;
      siteCounts.set(site,ordinal+1);
      const id = `fc-op-${symbolId++}-${site}-${ordinal}`;
      // Keep the native postfix spacing of ! (notably after \left...\right).
      // A forced mathclose atom discards that spacing in MathJax 4.
      if (a.op === 'fact') return `\\cssId{${id}}{${glyph}}`;
      return `\\${texClass}{\\cssId{${id}}{${a.op === 'fact' ? glyph : center(glyph,opt)}}}`;
    }
    function write(a) {
      if (a.op === 'lit') {
        let out = ''; for (let i = a.i; i < a.j; i++) out += mark(`d${i}`,code[i],opt);
        return out;
      }
      if (a.op === 'sqrt') return structure('root',a,`\\sqrt{${write(a.a)}}`);
      if (a.op === 'neg') {
        let x = write(a.a);
        if (precedence(a.a,opt) <= 30) x = enclose(a.a,x);
        return symbol(a,'-','mathord') + x;
      }
      if (a.op === 'fact') {
        // (n!)! must not become n!!, which conventionally means double factorial.
        const x = write(a.a);
        return (['lit','sqrt'].includes(a.a.op) ? x : enclose(a.a,x)) + symbol(a,'!','mathclose');
      }
      if (a.op === 'pow') {
        let x = write(a.a);
        if (precedence(a.a,opt) <= 40 || ['div','sqrt'].includes(a.a.op)) x = enclose(a.a,x);
        return `{${x}}^{${write(a.b)}}`;
      }
      if (a.op === 'div' && opt.division === 'fraction') return structure('frac',a,`\\frac{${write(a.a)}}{${write(a.b)}}`);
      const p = precedence(a,opt);
      function child(x, right) {
        const q = precedence(x,opt), tex = write(x);
        // Equal-precedence infix operators associate to the LEFT. Only homogeneous
        // sums/products may be flattened; subtraction/division retain right groups.
        const homogeneous = n => precedence(n,opt) !== p ||
          (n.op === a.op && homogeneous(n.a) && homogeneous(n.b));
        const associative = (a.op === 'add' || a.op === 'mul') && x.op === a.op && homogeneous(x);
        return q < p || (right && ((q === p && !associative) || x.op === 'neg')) ? enclose(x,tex) : tex;
      }
      const glyph = {add:'+', sub:'-', mul:'\\times', div:'\\div'}[a.op];
      if (!glyph) throw new TypeError(`Unsupported operation: ${a.op}`);
      return `${child(a.a,false)} ${symbol(a,glyph,'mathbin')} ${child(a.b,true)}`;
    }
    return write(ast);
  }
  function frameTex(ast, code, seconds, settings = {}) {
    assertCode(code);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 59) throw new TypeError('Invalid second');
    const opt = options(settings), ss = String(seconds).padStart(2,'0');
    const right = mark('s0',ss[0],opt) + mark('s1',ss[1],opt);
    if (ast) return `${expressionTex(ast,code,opt)} ${relation(opt)} ${right}`;
    const colon = `\\mkern2mu\\mathord{${center(':',opt)}}\\mkern2mu`;
    return mark('d0',code[0],opt) + mark('d1',code[1],opt) + colon + mark('d2',code[2],opt) + mark('d3',code[3],opt) + colon + right;
  }
  function plain(ast, code) {
    if (ast.op === 'lit') return code.slice(ast.i,ast.j);
    const a = plain(ast.a,code);
    if (ast.op === 'sqrt') return `√(${a})`;
    if (ast.op === 'neg') return `−(${a})`;
    if (ast.op === 'fact') return `(${a})!`;
    return `(${a} ${{add:'+',sub:'−',mul:'×',div:'÷',pow:'^'}[ast.op]} ${plain(ast.b,code)})`;
  }
  const api = { assertCode, validateAst, expressionTex, frameTex, mark, relation, options, plain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormulaExpression = Object.freeze(api);
})(typeof window === 'undefined' ? globalThis : window);
