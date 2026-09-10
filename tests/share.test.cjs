'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const Share=require('../share.ts');
const snapshot={v:1,t:'123421',font:'stix2',numerals:'oldstyle',division:'fraction',ast:{op:'mul',a:{op:'add',a:{op:'lit',i:0,j:1},b:{op:'lit',i:1,j:2}},b:{op:'add',a:{op:'lit',i:2,j:3},b:{op:'lit',i:3,j:4}}}};
test('share titles use the saved expression with slash division and caret powers',()=>{
  const L=i=>({op:'lit',i,j:i+1}),B=(op,a,b)=>({op,a,b});
  const state=Share.snapshot({...snapshot,t:'123405',ast:B('add',L(0),B('div',B('pow',L(1),L(2)),{op:'sqrt',a:L(3)}))});
  assert.equal(Share.title(state),'1 + 2^3 / √4 = 5');
  assert.equal(Share.title({...state,division:'inline'}),Share.title(state));
  assert.equal(Share.title(snapshot),'(1 + 2) × (3 + 4) = 21');
  assert.equal(Share.title({...state,ast:null}),'Formula Clock — 12:34:05');
  assert.equal(Share.title(null),'Formula Clock');
  assert.equal(require('../expression.ts').plain(state.ast,'1234'),'1 + 2^3 ÷ √4');
});
test('link cards use time titles and compact expressions with grouping preserved',()=>{
  const L=(i,j=i+1)=>({op:'lit',i,j}),B=(op,a,b)=>({op,a,b}),U=(op,a)=>({op,a});
  const example=Share.snapshot({...snapshot,t:'235044',ast:B('add',U('neg',B('mul',L(0),L(1))),L(2,4))});
  assert.deepEqual(Share.card(example),{title:'Formula Clock - 23:50:44',description:'-(2x3)+50=44'});
  assert.deepEqual(Share.card({...example,ast:null}),{title:'Formula Clock - 23:50:44',description:'23:50:44'});
  assert.deepEqual(Share.card(null),{title:'Formula Clock',description:null});
  const compact=require('../expression.ts').compact;
  for(const [ast,text] of [
    [B('add',L(0),B('div',B('pow',L(1),L(2)),U('sqrt',L(3)))),'1+2^3/√4'],
    [B('div',L(0),B('div',L(1),B('add',L(2),L(3)))),'1/(2/(3+4))'],
    [B('sub',L(0),B('add',L(1),B('mul',L(2),L(3)))),'1-(2+3x4)'],
    [B('pow',B('pow',L(0),L(1)),B('add',L(2),L(3))),'(1^2)^(3+4)'],
    [B('pow',L(0),B('pow',L(1),B('add',L(2),L(3)))),'1^2^(3+4)'],
    [B('add',B('pow',U('neg',L(0)),L(1)),B('mul',L(2),L(3))),'(-1)^2+3x4'],
    [B('add',U('fact',U('fact',L(0))),B('mul',L(1),B('add',L(2),L(3)))),'(1!)!+2x(3+4)'],
    [B('add',U('fact',L(0)),B('mul',L(1),B('mul',L(2),L(3)))),'1!+2x3x4'],
    [B('add',L(0),B('add',L(1),B('add',L(2),L(3)))),'1+2+3+4'],
    [B('mul',L(0),B('div',L(1),B('mul',L(2),L(3)))),'1x(2/(3x4))'],
    [B('add',B('pow',U('sqrt',L(0)),L(1)),B('pow',L(2),U('neg',L(3)))),'(√1)^2+3^-4'],
    [B('add',U('sqrt',B('pow',L(0),L(1))),B('pow',L(2),L(3))),'√(1^2)+3^4'],
    [B('add',U('fact',U('sqrt',L(0))),B('mul',L(1),B('mul',L(2),L(3)))),'(√1)!+2x3x4'],
    [B('add',U('sqrt',U('fact',L(0))),B('mul',L(1),B('mul',L(2),L(3)))),'√(1!)+2x3x4']
  ]) assert.equal(compact(ast,'1234'),text);
});
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
test('speculative and clicked saves share one request; accepted exact snapshots hit the cache',async()=>{
  let release, calls=[];
  const cache=new Share.LinkCache(null,async(input,init)=>{
    calls.push({input,init});await new Promise(resolve=>{release=resolve;});
    return Response.json({id:'Abc0123X9z'},{status:202});
  });
  const first=cache.prepare(snapshot),second=cache.prepare({...snapshot});
  assert.equal(first,second);assert.equal(cache.peek(snapshot),null);
  await Promise.resolve();assert.equal(calls.length,1);assert.equal(calls[0].input,'/api/shares');
  assert.deepEqual(JSON.parse(calls[0].init.body),snapshot);
  release();assert.equal(await first,'Abc0123X9z');assert.equal(cache.peek(snapshot),'Abc0123X9z');
  for(const changes of [{t:'123422'},{font:'termes'},{numerals:'lining'},{division:'inline'},{ast:null}])
    assert.equal(cache.peek({...snapshot,...changes}),null);
  assert.equal(await cache.prepare(snapshot),'Abc0123X9z');assert.equal(calls.length,1);
  const seeded=new Share.LinkCache({id:'Abc0123X9z',snapshot},()=>{throw Error('Unexpected save');});
  assert.equal(seeded.peek(snapshot),'Abc0123X9z');
  assert.equal(await seeded.prepare(snapshot),'Abc0123X9z');
});
test('cancelled or failed speculative saves cannot publish stale ids and remain retryable',async()=>{
  let release,signal,attempts=0;
  const cache=new Share.LinkCache(null,async(input,init)=>{
    attempts++;signal=init.signal;
    if(attempts===1)await new Promise(resolve=>{release=resolve;});
    return Response.json({id:'Abc0123X9z'});
  });
  const pending=cache.prepare(snapshot),rejection=assert.rejects(pending,{name:'AbortError'});
  await Promise.resolve();cache.cancelPending();assert.ok(signal.aborted);
  release();await rejection;assert.equal(cache.peek(snapshot),null);
  assert.equal(await cache.prepare(snapshot),'Abc0123X9z');assert.equal(attempts,2);
  for(const response of [Response.json({id:'invalid'}),Response.json({}, {status:503})]){
    let calls=0;
    const failed=new Share.LinkCache(null,async()=>++calls===1?response:Response.json({id:'Abc0123X9z'}));
    await assert.rejects(failed.prepare(snapshot));assert.equal(failed.peek(snapshot),null);
    assert.equal(await failed.prepare(snapshot),'Abc0123X9z');
  }
});
test('the speculative cache bounds retained entries and aborts timed-out saves',async()=>{
  let calls=0;
  const cache=new Share.LinkCache(null,async()=>Response.json({id:String(++calls).padStart(10,'0')}));
  for(let seconds=0;seconds<13;seconds++)await cache.prepare({...snapshot,t:'1234'+String(seconds).padStart(2,'0')});
  assert.equal(cache.peek({...snapshot,t:'123400'}),null);
  assert.equal(cache.peek({...snapshot,t:'123412'}),'0000000013');
  const hanging=new Share.LinkCache(null,async(input,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }),5);
  await assert.rejects(hanging.prepare(snapshot),{name:'AbortError'});
  assert.equal(hanging.peek(snapshot),null);
});
