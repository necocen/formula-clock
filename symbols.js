/* Match visual operators only while they keep their place among HHMM slots. */
(function (root) {
  'use strict';
  // A site encodes the operator's role plus either a binary gap or a unary
  // operand interval/nesting ordinal. Screen coordinates never decide identity.
  // Result maps each destination to a source index, or -1 for a new glyph.
  const identity = token => `${token.kind}:${token.site}:${token.glyphKey || ''}`;
  function match(previous,next) {
    const available=new Map();
    previous.forEach((token,index)=>{
      if(typeof token.site!=='string')return;
      const key=identity(token),group=available.get(key)||[];
      // An active glyph takes precedence over a fading remnant at the same site.
      if(token.exiting)group.push(index);else group.unshift(index);
      available.set(key,group);
    });
    return next.map(token=>{
      if(typeof token.site!=='string')return -1;
      return available.get(identity(token))?.shift() ?? -1;
    });
  }
  const api=Object.freeze({match});
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  else root.FormulaSymbols=api;
})(typeof window==='undefined'?globalThis:window);
