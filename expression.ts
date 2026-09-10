import {isRecord, type Expr, type TexOptions} from './types.ts';
/* The public expression format and its presentation-independent serializer.
 * Leaves reference HHMM positions [i,j); they never contain numeric values.
 */
const UNARY = new Set<unknown>(['neg', 'sqrt', 'fact']);
const BINARY = new Set<unknown>(['add', 'sub', 'mul', 'div', 'pow']);
const validCode = (code: unknown): code is string => typeof code === 'string' && /^(?:[01]\d|2[0-3])[0-5]\d$/.test(code);
function assertCode(code: unknown): asserts code is string { if (!validCode(code)) throw new TypeError('HHMM must be a 24-hour time (0000–2359)'); }

// Return a new, bounded, immutable tree. No getters/extra keys survive this boundary.
function validateAst(ast: unknown, code: string): Expr | null {
  assertCode(code);
  if (ast === null) return null;
  let nodes = 0; const slots: number[] = [], active = new Set<object>();
  function visit(x: unknown, depth: number): Expr {
    if (!isRecord(x) || ++nodes > 96 || depth > 24 || active.has(x)) {
      throw new TypeError('Invalid or excessively deep expression tree');
    }
    active.add(x); let out: Expr;
    if (x.op === 'lit') {
      const {i, j} = x;
      if (typeof i !== 'number' || typeof j !== 'number' || !Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j > 4 || i >= j) throw new TypeError('Invalid digit interval');
      if (j - i > 1 && code[i] === '0') throw new TypeError('Leading zero in a concatenated number');
      for (let k = i; k < j; k++) slots.push(k);
      out = {op:'lit', i:i as 0|1|2|3, j:j as 1|2|3|4};
    } else if (UNARY.has(x.op)) out = {op:x.op as 'neg'|'sqrt'|'fact', a:visit(x.a, depth + 1)};
    else if (BINARY.has(x.op)) out = {op:x.op as 'add'|'sub'|'mul'|'div'|'pow', a:visit(x.a, depth + 1), b:visit(x.b, depth + 1)};
    else throw new TypeError(`Unknown operation: ${String(x.op)}`);
    const allowed = Object.keys(out);
    if (Object.keys(x).some(key => !allowed.includes(key))) throw new TypeError(`Unexpected expression field (${x.op})`);
    active.delete(x); return Object.freeze(out);
  }
  const result = visit(ast, 0);
  if (slots.join(',') !== '0,1,2,3') throw new TypeError('Use each HHMM position exactly once, in order');
  return result;
}

function options(value: Partial<TexOptions> = {}): TexOptions {
  const division = value.division ?? 'fraction';
  if (!['fraction','inline'].includes(division)) throw new TypeError('Unknown division style');
  return { division, oldstyle: !!value.oldstyle, centerOperators: value.centerOperators !== false, symbolMotion: value.symbolMotion === true, structureMotion: value.structureMotion === true, symbolMorph: value.symbolMorph === true };
}
function mark(slot: string, digit: string, opt: Pick<TexOptions,'oldstyle'>) {
  const glyph = opt.oldstyle ? `{\\oldstyle ${digit}}` : digit;
  return `\\cssId{fc-${slot}}{${glyph}}`;
}
const parens = (text: string) => `\\left(${text}\\right)`;
const center = (symbol: string, opt: Pick<TexOptions,'centerOperators'>) => opt.centerOperators ? `\\vcenter{${symbol}}` : symbol;
const binary = (symbol: string, opt: Pick<TexOptions,'centerOperators'>) => opt.centerOperators ? `\\mathbin{${center(symbol,opt)}}` : symbol;
const negative = (opt: Pick<TexOptions,'centerOperators'>) => opt.centerOperators ? '\\mathord{\\vcenter{-}}' : '-';
const relation = (opt: Pick<TexOptions,'centerOperators'>) => `\\mathrel{\\cssId{fc-eq}{${center('=',opt)}}}`;

// Precedence is a property of the PRESENTATION. A fraction is a visual group;
// an obelus is a left-associative infix operator with multiplication's priority.
function precedence(ast: Expr, opt: TexOptions): number {
  if (ast.op === 'lit' || ast.op === 'sqrt' || (ast.op === 'div' && opt.division === 'fraction')) return 60;
  return {add:10, sub:10, mul:20, div:20, neg:30, pow:40, fact:50}[ast.op];
}
function expressionTex(ast: Expr, code: string, settings: Partial<TexOptions> = {}): string {
  assertCode(code);
  const opt = options(settings);
  let symbolId = 0;
  const siteCounts = new Map();
  function interval(a: Expr): [number,number] {
    if (a.op === 'lit') return [a.i,a.j];
    const left = interval(a.a);
    return [left[0],'b' in a ? interval(a.b)[1] : left[1]];
  }
  function structure(role: 'frac'|'root'|'paren', a: Expr, tex: string): string {
    if (!opt.structureMotion) return tex;
    const [i,j] = interval(a);
    const site = `${role}-${role === 'frac' && 'b' in a ? `b${interval(a.a)[1]}` : `u${i}${j}`}`;
    const ordinal = siteCounts.get(site) || 0;
    siteCounts.set(site,ordinal+1);
    return `\\cssId{fc-struct-${site}-${ordinal}}{${tex}}`;
  }
  const enclose = (a: Expr,tex: string) => structure('paren',a,parens(tex));
  function symbol(a: Exclude<Expr,{op:'lit'}>, glyph: string, texClass: string): string {
    if (!opt.symbolMotion && !(opt.symbolMorph && ['add','sub','mul','div'].includes(a.op))) {
      if (a.op === 'neg') return negative(opt);
      return a.op === 'fact' ? glyph : binary(glyph,opt);
    }
    const [i,j] = interval(a);
    // Binary operators belong to a gap between HHMM slots. Unary operators
    // belong to their operand's slot interval, with an ordinal for nesting.
    const attachment = 'b' in a ? `b${interval(a.a)[1]}` : `u${i}${j}`;
    const site = `${a.op}-${attachment}`;
    const ordinal = siteCounts.get(site) || 0;
    siteCounts.set(site,ordinal+1);
    const id = `fc-op-${symbolId++}-${site}-${ordinal}`;
    // Keep the native postfix spacing of ! (notably after \left...\right).
    // A forced mathclose atom discards that spacing in MathJax 4.
    if (a.op === 'fact') return `\\cssId{${id}}{${glyph}}`;
    return `\\${texClass}{\\cssId{${id}}{${center(glyph,opt)}}}`;
  }
  function write(a: Expr): string {
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
    function child(x: Expr, right: boolean): string {
      const q = precedence(x,opt), tex = write(x);
      // Equal-precedence infix operators associate to the LEFT. Only homogeneous
      // sums/products may be flattened; subtraction/division retain right groups.
      const homogeneous = (n: Expr): boolean => precedence(n,opt) !== p ||
        (n.op === a.op && 'b' in n && homogeneous(n.a) && homogeneous(n.b));
      const associative = (a.op === 'add' || a.op === 'mul') && x.op === a.op && homogeneous(x);
      return q < p || (right && ((q === p && !associative) || x.op === 'neg')) ? enclose(x,tex) : tex;
    }
    const glyph = {add:'+', sub:'-', mul:'\\times', div:'\\div'}[a.op];
    if (!glyph) throw new TypeError(`Unsupported operation: ${a.op}`);
    return `${child(a.a,false)} ${symbol(a,glyph,'mathbin')} ${child(a.b,true)}`;
  }
  return write(ast);
}
function frameTex(ast: Expr | null, code: string, seconds: number, settings: Partial<TexOptions> = {}): string {
  assertCode(code);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 59) throw new TypeError('Invalid second');
  const opt = options(settings), ss = String(seconds).padStart(2,'0');
  const right = mark('s0',ss[0],opt) + mark('s1',ss[1],opt);
  if (ast) return `${expressionTex(ast,code,opt)} ${relation(opt)} ${right}`;
  const colon = `\\mkern2mu\\mathord{${center(':',opt)}}\\mkern2mu`;
  return mark('d0',code[0],opt) + mark('d1',code[1],opt) + colon + mark('d2',code[2],opt) + mark('d3',code[3],opt) + colon + right;
}
/** Both text styles use the same grouping rules, independently of SVG/TeX. */
function expressionText(ast: Expr, code: string, style: {space: string; minus: string; multiply: string; division: string}): string {
  const opt = options({division:'inline'}), group = (text: string) => `(${text})`;
  function write(a: Expr): string {
    if (a.op === 'lit') return code.slice(a.i,a.j);
    const left = write(a.a);
    if (a.op === 'sqrt') return '√' + (a.a.op === 'lit' ? left : group(left));
    if (a.op === 'neg') return style.minus + (precedence(a.a,opt) <= 30 ? group(left) : left);
    // Text has no radical bar: (√4)! and (√4)^2 must not look like √(4!) / √(4^2).
    // Also retain (n!)!, since n!! conventionally means double factorial.
    if (a.op === 'fact') return (a.a.op === 'lit' ? left : group(left)) + '!';
    const right = write(a.b);
    // Powers associate to the right; a negative exponent is unambiguous after ^.
    if (a.op === 'pow') return (precedence(a.a,opt) <= 40 || a.a.op === 'sqrt' ? group(left) : left) + '^' +
      (precedence(a.b,opt) < 30 ? group(right) : right);
    const p = precedence(a,opt);
    function child(node: Expr,text: string,isRight: boolean) {
      const q = precedence(node,opt);
      const homogeneous = (n: Expr): boolean => precedence(n,opt) !== p ||
        (n.op === a.op && 'b' in n && homogeneous(n.a) && homogeneous(n.b));
      const associative = (a.op === 'add' || a.op === 'mul') && node.op === a.op && homogeneous(node);
      return q < p || (isRight && ((q === p && !associative) || node.op === 'neg')) ? group(text) : text;
    }
    const glyph = {add:'+',sub:style.minus,mul:style.multiply,div:style.division}[a.op];
    return child(a.a,left,false) + style.space + glyph + style.space + child(a.b,right,true);
  }
  return write(ast);
}
function plain(ast: Expr, code: string, options: {division?: '÷' | '/'} = {}): string {
  return expressionText(ast,code,{space:' ',minus:'−',multiply:'×',division:options.division || '÷'});
}
/** Compact text for link cards; grouping follows the AST, never TeX replacement. */
function compact(ast: Expr, code: string): string {
  return expressionText(ast,code,{space:'',minus:'-',multiply:'x',division:'/'});
}
const api = { assertCode, validateAst, expressionTex, frameTex, mark, relation, options, plain, compact };
export {assertCode,validateAst,expressionTex,frameTex,mark,relation,options,plain,compact};
export default Object.freeze(api);
