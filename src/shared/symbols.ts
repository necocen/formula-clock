import type { SymbolIdentity } from './types.ts';
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
const api = Object.freeze({ match, morphPair });
export { match, morphPair };
export default Object.freeze(api);
