/* Match visual operators only while they keep their place among HHMM slots. */
(function (root) {
  'use strict';
  // A site encodes the operator's role plus either a binary gap or a unary
  // operand interval/nesting ordinal. Screen coordinates never decide identity.
  // Result maps each destination to a source index, or -1 for a new glyph.
  const identity = token => `${token.kind}:${token.site}:${token.glyphKey || ''}`;
  function morphPair(a,b) {
    const gap = token => {
      const role = token.kind === '+' ? 'add' : token.kind === '×' ? 'mul' : null;
      return role && token.site?.match(new RegExp(`^${role}-(b[1-3]-\\d+)$`))?.[1];
    };
    const site = gap(a);
    return !!site && site === gap(b) && a.kind !== b.kind && !!a.font && a.font === b.font;
  }
  function match(previous,next,{morph=false}={}) {
    const available=new Map();
    previous.forEach((token,index)=>{
      if(typeof token.site!=='string')return;
      const key=identity(token),group=available.get(key)||[];
      // An active glyph takes precedence over a fading remnant at the same site.
      if(token.exiting)group.push(index);else group.unshift(index);
      available.set(key,group);
    });
    const matches = next.map(token=>{
      if(typeof token.site!=='string')return -1;
      return available.get(identity(token))?.shift() ?? -1;
    });
    // Reserve exact identities first. Only a currently active +/× at this very
    // gap can stand in for the other; fading remnants cannot bridge another op.
    if (morph) {
      const used = new Set(matches.filter(index=>index >= 0));
      next.forEach((token,i)=>{
        if (matches[i] >= 0) return;
        const index = previous.findIndex((old,j)=>!used.has(j) && !old.exiting && morphPair(old,token));
        if (index >= 0) { matches[i]=index; used.add(index); }
      });
    }
    return matches;
  }
  const api=Object.freeze({match,morphPair});
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.FormulaSymbols=api;
})(typeof window==='undefined'?globalThis:window);
