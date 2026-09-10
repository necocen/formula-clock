'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs');
const {SCHEMA,InlineProvider,FetchMinuteProvider,TableProvider,normalizeMinute}=require('../data.ts');
const table=require('../data/expressions.json');
(async()=>{
 const checks=[];
 const inline=new InlineProvider(table);const minute=await inline.getMinute('1234');
 assert.equal(minute.seconds.length,60);assert.ok(Object.isFrozen(minute.seconds));
 assert.equal(minute.seconds[8].op,'add');
 const missing=new InlineProvider({schema:SCHEMA,minutes:{'1234':Array(60).fill(null)}});
 await assert.rejects(missing.getMinute('0000'),/absent/);
 assert.equal((await missing.getMinute('1234')).seconds[0],null);
 checks.push('Missing minute is an error; explicit null is an ordinary-clock instruction');
 const ac=new AbortController();ac.abort();await assert.rejects(inline.getMinute('1234',{signal:ac.signal}),{name:'AbortError'});
 let called=0;
 const shared=new TableProvider(async()=>{called++;await new Promise(resolve=>setTimeout(resolve,15));return table;});
 await Promise.all([shared.getMinute('1234'),shared.getMinute('0000')]);assert.equal(called,1);
 let tries=0;const retry=new TableProvider(async()=>{if(++tries===1)throw Error('temporary');return table;});
 await assert.rejects(retry.getMinute('1234'));await retry.getMinute('1234');assert.equal(tries,2);
 checks.push('One async all-day load is shared; failed load retries; abort is respected');
 const original=global.fetch;let seen;
 try {
  global.fetch=async(url,options)=>{seen={url,options};return {ok:true,json:async()=>minute};};
  const fetcher=new FetchMinuteProvider(hhmm=>`https://example.test/${hhmm}.json`);
  assert.equal((await fetcher.getMinute('1234')).hhmm,'1234');assert.equal(seen.url,'https://example.test/1234.json');
  global.fetch=async()=>({ok:false,status:404});await assert.rejects(fetcher.getMinute('1234'),/404/);
  global.fetch=async()=>({ok:true,json:async()=>({...minute,hhmm:'1235'})});await assert.rejects(fetcher.getMinute('1234'),/1234/);
 } finally {global.fetch=original;}
 checks.push('Async minute fetching checks HTTP status and HHMM identity');
 for(const bad of [undefined,{},[],{op:'lit',i:0,j:5}])assert.throws(()=>normalizeMinute({schema:SCHEMA,hhmm:'1234',seconds:Array(60).fill(bad)},'1234'));
 checks.push('Malformed trees, absent second entries and invalid intervals are rejected');
 const report={build:'r6-minimal',checks};console.log(report);require('./report.cjs')('provider-results.json',report);
})().catch(error=>{console.error(error);process.exitCode=1;});
