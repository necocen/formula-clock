import type { DisplayOptions, Expr, SymbolIdentity } from './types.ts';
export type OperatorRole = 'add' | 'sub' | 'neg' | 'mul' | 'div' | 'fact';
export type StructureRole = 'frac' | 'root' | 'paren';
const operatorKinds = { add: '+', sub: '−', neg: '−', mul: '×', div: '÷', fact: '!' } as const;

function interval(ast: Expr): [number, number] {
  if (ast.op === 'lit') return [ast.i, ast.j];
  const left = interval(ast.a);
  return [left[0], 'b' in ast ? interval(ast.b)[1] : left[1]];
}

/** One marker sequence per expression, shared by TeX writers and SVG readers. */
function createMarkers() {
  let serial = 0;
  const counts = new Map<string, number>();
  function site(role: OperatorRole | StructureRole, ast: Expr, binary: boolean) {
    const [i, j] = interval(ast);
    const attachment = binary && 'b' in ast ? `b${interval(ast.a)[1]}` : `u${i}${j}`;
    const key = `${role}-${attachment}`;
    const ordinal = counts.get(key) || 0;
    counts.set(key, ordinal + 1);
    return `${key}-${ordinal}`;
  }
  return {
    operator(ast: Extract<Expr, { op: OperatorRole }>) {
      return `fc-op-${serial++}-${site(ast.op, ast, 'b' in ast)}`;
    },
    structure(role: StructureRole, ast: Expr) {
      return `fc-struct-${site(role, ast, role === 'frac')}`;
    },
  };
}
function readOperator(id: string, division: DisplayOptions['division']) {
  const match = /^fc-op-\d+-(add|sub|neg|mul|div|fact)-(b[1-3]|u[0-3][1-4])-(\d+)$/.exec(id);
  if (!match) throw new Error(`Invalid operator marker: ${id}`);
  const [, role, attachment, ordinal] = match;
  return {
    role: role as OperatorRole,
    kind: role === 'div' && division === 'slash' ? '/' : operatorKinds[role as OperatorRole],
    site: `${role}-${attachment}-${ordinal}`,
  };
}
function readStructure(id: string) {
  const match = /^fc-struct-(frac|root|paren)-(b[1-3]|u[0-3][1-4])-(\d+)$/.exec(id);
  if (!match) throw new Error(`Invalid structure marker: ${id}`);
  const [, role, attachment, ordinal] = match;
  return { role: role as StructureRole, site: `${role}-${attachment}-${ordinal}` };
}
/* Match visual operators only while they keep their place among HHMM slots. */
// A site encodes the operator's role plus either a binary gap or a unary
// operand interval/nesting ordinal. Screen coordinates never decide identity.
// Result maps each destination to a source index, or -1 for a new glyph.
const identity = (token: SymbolIdentity) => `${token.kind}:${token.site}:${token.glyphKey || ''}`;
function morphPair(a: SymbolIdentity, b: SymbolIdentity) {
  const gap = (token: SymbolIdentity) => {
    const roles: Record<string, string> = { '+': 'add', '−': 'sub', '×': 'mul', '÷': 'div' };
    const role = roles[token.kind];
    return role && token.site?.match(new RegExp(`^${role}-(b[1-3]-\\d+)$`))?.[1];
  };
  const site = gap(a);
  return !!site && site === gap(b) && a.kind !== b.kind && !!a.font && a.font === b.font;
}
function match(
  previous: readonly SymbolIdentity[],
  next: readonly SymbolIdentity[],
  { morph = false } = {},
) {
  const available = new Map<string, number[]>();
  previous.forEach((token, index) => {
    if (typeof token.site !== 'string') return;
    const key = identity(token),
      group = available.get(key) || [];
    // An active glyph takes precedence over a fading remnant at the same site.
    if (token.exiting) group.push(index);
    else group.unshift(index);
    available.set(key, group);
  });
  const matches = next.map((token) => {
    if (typeof token.site !== 'string') return -1;
    return available.get(identity(token))?.shift() ?? -1;
  });
  // Reserve exact identities first. Only an active arithmetic sign at this
  // very gap can become another; unary signs and fading remnants cannot.
  if (morph) {
    const used = new Set(matches.filter((index) => index >= 0));
    next.forEach((token, i) => {
      if (matches[i] >= 0) return;
      const index = previous.findIndex(
        (old, j) => !used.has(j) && !old.exiting && morphPair(old, token),
      );
      if (index >= 0) {
        matches[i] = index;
        used.add(index);
      }
    });
  }
  return matches;
}
const api = Object.freeze({ createMarkers, readOperator, readStructure, match, morphPair });
export { createMarkers, readOperator, readStructure, match, morphPair };
export default Object.freeze(api);
