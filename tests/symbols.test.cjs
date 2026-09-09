'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {match}=require('../symbols.js');
const glyph=(kind,site,extra={})=>({kind,site,...extra});
test('empty frames and glyphs without an attachment are never accidentally reused',()=>{
  assert.deepEqual(match([],[]),[]);
  assert.deepEqual(match([],[glyph('+','add-b1-0')]),[-1]);
  assert.deepEqual(match([glyph('+')],[glyph('+')]),[-1]);
});
test('swapped minus and plus signs disappear instead of exchanging gaps',()=>{
  const old=[glyph('−','sub-b1-0'),glyph('+','add-b2-0'),glyph('+','add-b3-0')];
  const next=[glyph('+','add-b1-0'),glyph('−','sub-b2-0'),glyph('+','add-b3-0')];
  assert.deepEqual(match(old,next),[-1,-1,2]);
});
test('factorials stay with the same operand slots; equal digit values do not confer identity',()=>{
  assert.deepEqual(match([glyph('!','fact-u01-0')],[glyph('!','fact-u12-0')]),[-1]);
  assert.deepEqual(match([glyph('!','fact-u02-0')],[glyph('!','fact-u12-0')]),[-1]);
  assert.deepEqual(match([glyph('!','fact-u23-0')],[glyph('!','fact-u23-0')]),[0]);
});
test('unary minus cannot become subtraction or attach to another operand',()=>{
  assert.deepEqual(match([glyph('−','neg-u01-0')],[glyph('−','sub-b1-0')]),[-1]);
  assert.deepEqual(match([glyph('−','neg-u01-0')],[glyph('−','neg-u04-0')]),[-1]);
});
test('a stable attachment survives movement, resizing, and unrelated operator insertions',()=>{
  const old=[glyph('+','add-b2-0',{x:0,scale:1}),glyph('×','mul-b3-0')];
  const next=[glyph('−','neg-u01-0'),glyph('+','add-b2-0',{x:200,scale:.7})];
  assert.deepEqual(match(old,next),[-1,0]);
});
test('nested unary operators keep their inner/outer ordinal instead of swapping',()=>{
  const old=[glyph('!','fact-u23-0'),glyph('!','fact-u23-1')];
  assert.deepEqual(match(old,[glyph('!','fact-u23-0')]),[0]);
  assert.deepEqual(match(old,[glyph('!','fact-u23-1'),glyph('!','fact-u23-0')]),[1,0]);
});
test('each source can be consumed once and a live glyph wins over an exiting one',()=>{
  const old=[glyph('+','add-b1-0',{exiting:true}),glyph('+','add-b1-0')];
  assert.deepEqual(match(old,[glyph('+','add-b1-0'),glyph('+','add-b1-0'),glyph('+','add-b1-0')]),[1,0,-1]);
});
test('structural glyphs reuse only the same font, size variant and attachment',()=>{
  const a=glyph('root-sign','root-u04-0',{glyphKey:'stix2@4.1.3:-smallop:221A'});
  assert.deepEqual(match([a],[{...a}]),[0]);
  assert.deepEqual(match([a],[{...a,glyphKey:'stix2@4.1.3:-largeop:221A'}]),[-1]);
  assert.deepEqual(match([a],[{...a,glyphKey:'euler@4.1.3:-smallop:221A'}]),[-1]);
  assert.deepEqual(match([a],[{...a,site:'root-u14-0'}]),[-1]);
});
test('radical sign and rule are replaced together on size change; fraction rules retain their gap',()=>{
  const a=['root-sign','root-rule'].map(kind=>glyph(kind,'root-u04-0',{glyphKey:'normal:221A'}));
  assert.deepEqual(match(a,a),[0,1]);
  assert.deepEqual(match(a,a.map(x=>({...x,glyphKey:'-smallop:221A'}))),[-1,-1]);
  const f=glyph('fraction-rule','frac-b2-0',{glyphKey:'rule'});
  assert.deepEqual(match([f],[f,{...f,site:'frac-b3-0'}]),[0,-1]);
});
test('part 3 morphs every directed arithmetic pair only at the same gap and font',()=>{
  const signs=Object.entries({'+':'add','−':'sub','×':'mul','÷':'div'}).map(([kind,op])=>glyph(kind,`${op}-b1-0`,{font:'stix2'}));
  for (const a of signs) for (const b of signs) if(a.kind!==b.kind) {
    assert.deepEqual(match([a],[b]),[-1]);
    assert.deepEqual(match([a],[b],{morph:true}),[0]);
    assert.deepEqual(match([a],[{...b,site:b.site.replace('b1','b2')}],{morph:true}),[-1]);
    assert.deepEqual(match([a],[{...b,site:b.site.replace('-0','-1')}],{morph:true}),[-1]);
    assert.deepEqual(match([a],[{...b,font:'euler'}],{morph:true}),[-1]);
    assert.deepEqual(match([{...a,exiting:true}],[b],{morph:true}),[-1]);
    assert.deepEqual(match([{...a,font:undefined}],[b],{morph:true}),[-1]);
  }
  for (const a of signs) for (const b of [glyph('−','neg-u01-0'),glyph('!','fact-u01-0'),glyph('fraction-rule','frac-b1-0')]) {
    const other={...b,font:'stix2'};
    assert.deepEqual(match([a],[other],{morph:true}),[-1]);
    assert.deepEqual(match([other],[a],{morph:true}),[-1]);
  }
});
test('rotation matches never steal an exact identity or exchange gaps',()=>{
  const old=[glyph('+','add-b1-0',{font:'euler'}),glyph('×','mul-b2-0',{font:'euler'})];
  const next=[glyph('×','mul-b1-0',{font:'euler'}),glyph('+','add-b2-0',{font:'euler'})];
  assert.deepEqual(match(old,next,{morph:true}),[0,1]);
  assert.deepEqual(match(old,[old[0],next[0]],{morph:true}),[0,-1]);
});
