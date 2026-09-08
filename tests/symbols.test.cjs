'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {match}=require('../symbols.js');
const glyph=(kind,x,start=0,end=4,scale=1)=>({kind,x,y:0,start,end,scale,role:kind});
test('only equal glyph kinds can be reused; empty frames are supported',()=>{
  assert.deepEqual(match([],[]),[]);
  assert.deepEqual(match([],[glyph('+',0)]),[-1]);
  assert.deepEqual(match([glyph('+',0)],[glyph('×',0)]),[-1]);
});
test('duplicate operators match nearby positions and each old glyph is used once',()=>{
  const old=[glyph('+',0),glyph('+',200),glyph('+',400)];
  assert.deepEqual(match(old,[glyph('+',410),glyph('+',190)]),[2,1]);
  assert.deepEqual(match(old.slice(0,2),[glyph('+',10),glyph('+',190),glyph('+',500)]),[0,1,-1]);
});
test('surrounding digit slots and scale resolve otherwise equally distant symbols',()=>{
  assert.deepEqual(match([glyph('!',0,0,1),glyph('!',0,2,3)],[glyph('!',0,2,3)]),[1]);
  assert.deepEqual(match([glyph('+',0,0,4,.7),glyph('+',0)],[glyph('+',0)]),[1]);
});
test('assignment finds a global minimum instead of consuming the nearest glyph greedily',()=>{
  assert.deepEqual(match([glyph('+',0),glyph('+',10)],[glyph('+',6),glyph('+',11)]),[0,1]);
});
test('96 repeated symbols stay bounded, deterministic and one-to-one',()=>{
  const old=Array.from({length:96},(_,i)=>glyph('!',i*10));
  const next=old.slice().reverse();
  const expected=Array.from({length:96},(_,i)=>95-i);
  assert.deepEqual(match(old,next),expected);
});
