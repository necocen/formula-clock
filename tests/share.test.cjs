'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const Share=require('../share.ts');
const snapshot={v:1,t:'123421',font:'stix2',numerals:'oldstyle',division:'fraction',ast:{op:'mul',a:{op:'add',a:{op:'lit',i:0,j:1},b:{op:'lit',i:1,j:2}},b:{op:'add',a:{op:'lit',i:2,j:3},b:{op:'lit',i:3,j:4}}}};
test('snapshots preserve bounded ASTs and explicit null; reject extra fields and malformed trees',()=>{
  const saved=Share.snapshot(snapshot);assert.deepEqual(saved,snapshot);assert.notEqual(saved.ast,snapshot.ast);
  assert.ok(Object.isFrozen(saved) && Object.isFrozen(saved.ast));
  assert.equal(Share.snapshot({...snapshot,ast:null}).ast,null);
  for(const value of [null,{}, {...snapshot,ast:undefined},{...snapshot,ast:'x'},{...snapshot,url:'https://evil.example'},
    {...snapshot,ast:{op:'lit',i:0,j:1}},{...snapshot,ast:{...snapshot.ast,tex:'danger'}},{...snapshot,font:'unknown'}]) assert.throws(()=>Share.snapshot(value));
  const id='Abc0123X9z',url=Share.shortUrl('https://clock.example/old?old=1#old',id);
  assert.equal(url.href,`https://clock.example/s/${id}`);assert.equal(Share.id(url.pathname),id);
  for(const path of ['/s/x','/s/Abc0123_-x','/s/'+id+'/','/s/'+id+'/og.png','/s/../../etc','/s/'+id+'?x']) assert.equal(Share.id(path),null);
  assert.throws(()=>Share.shortUrl(url.origin,'../../x'));
  assert.deepEqual(Share.view({id,snapshot}),{id,snapshot});
});

test('every supported display choice and boundary time round-trips canonically',()=>{
  for(const t of ['000000','000059','005959','120000','235959'])
    for(const font of ['stix2','termes','fira','euler'])
      for(const numerals of ['lining','oldstyle'])
        for(const division of ['fraction','inline']){
          const state={v:1,t,font,numerals,division},url=Share.url('https://clock.example/ignored?old=1#fragment',state);
          assert.equal(url.pathname,'/');assert.equal(url.hash,'');
          assert.deepEqual(Share.parse(url),state);
          assert.equal(url.search,`?v=1&t=${t}&font=${font}&numerals=${numerals}&division=${division}`);
        }
});
test('defaults are independent of local preferences; invalid time/version is not a shared state',()=>{
  assert.deepEqual(Share.parse('https://clock.example/?t=123430&font=nope&numerals=bad&division=bad&extra=secret'),
    {v:1,t:'123430',font:'stix2',numerals:'oldstyle',division:'fraction'});
  for(const query of ['', 't=240000','t=126000','t=120060','t=12345','t=１２３４３０','t=12:34:30','t=123430&v=2','t=123430&v='])
    assert.equal(Share.parse(`https://clock.example/?${query}`),null,query);
  assert.throws(()=>Share.params({v:1,t:'123430',font:'../../escape'}),/Invalid/);
  assert.equal(Share.title(Share.parse('https://clock.example/?t=235334')),'Formula Clock — 23:53:34');
});
test('shared readings do not shift with recipient timezone or DST',()=>{
  const source=`const s=require('./share.ts');for(const t of ['000000','023000','123430','235959']){const d=s.localDate(t);if([d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join('')!==t)throw Error(t);}`;
  for(const TZ of ['Asia/Tokyo','America/Los_Angeles','Europe/London','Pacific/Apia'])
    execFileSync(process.execPath,['--import','tsx','-e',source],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,TZ}});
});
