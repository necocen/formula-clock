'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const E=require('../expression.ts'),D=require('../data.ts');
const {createSolver}=require('../tools/solver.ts');
const table=require('../data/expressions.json'), solver=createSolver();
const verifyExact=require('./verify-exact.cjs'), extended=[];

// Independent parser for the emitted TeX subset. It knows no serializer rules.
// Digit markers become slot tokens rather than their values (two zeroes differ).
function parse(tex) {
 // Structural markers enclose arbitrary nested TeX; remove only their wrapper.
 for (let mark; (mark=/\\cssId\{fc-struct-[^{}]+\}\{/.exec(tex));) {
  const start=mark.index+mark[0].length;let end=start,depth=1;
  for(;end<tex.length && depth;end++){if(tex[end]==='{')depth++;else if(tex[end]==='}')depth--;}
  assert.equal(depth,0,'Unbalanced structural marker');
  tex=tex.slice(0,mark.index)+tex.slice(start,end-1)+tex.slice(end);
 }
 const s=tex.replace(/\\cssId\{fc-op-\d+-(?:add|sub|neg|mul|div|fact)-(?:b[1-3]|u[0-3][1-4])-\d+\}\{(\\vcenter\{[^{}]+\}|[^{}]+)\}/g,'$1').replace(/\\mathbin\{\\vcenter\{(\\times|\\div|[+/\-])\}\}/g,'$1')
  .replace(/\\mathord\{\\vcenter\{-\}\}/g,'-')
  .replace(/\\(?:mathbin|mathord|mathclose)\{(\\times|\\div|[+!/\-])\}/g,'$1')
  .replace(/\\cssId\{fc-d(\d)\}\{(?:\{\\oldstyle\s+\d\}|\d)\}/g,'d$1')
  .replace(/\\(?:left|right)/g,'').replace(/\s+/g,'');
 let i=0;
 const take=x=>s.startsWith(x,i)?(i+=x.length,true):false;
 const need=x=>{if(!take(x))throw Error(`Expected ${x} at ${i}: ${s}`);};
 const bin=(op,a,b)=>({op,a,b}), un=(op,a)=>({op,a});
 function group(){need('{');const x=sum();need('}');return x;}
 function atom(){
  if(take('\\frac'))return bin('div',group(),group());
  if(take('\\sqrt'))return un('sqrt',group());
  if(s[i]==='{')return group();
  if(take('(')){const x=sum();need(')');return x;}
  const slots=[];while(s[i]==='d'){i++;slots.push(Number(s[i++]));}
  if(!slots.length)throw Error(`Expected digit at ${i}: ${s}`);
  for(let k=1;k<slots.length;k++)assert.equal(slots[k],slots[k-1]+1);
  return {op:'lit',i:slots[0],j:slots.at(-1)+1};
 }
 function fact(){let x=atom();while(take('!'))x=un('fact',x);return x;}
 function pow(){let x=fact();if(take('^'))x=bin('pow',x,unary());return x;}
 function unary(){if(take('-'))return un('neg',unary());return pow();}
 function product(){let x=unary();while(true){if(take('\\times'))x=bin('mul',x,unary());else if(take('\\div')||take('/'))x=bin('div',x,unary());else return x;}}
 function sum(){let x=product();while(true){if(take('+'))x=bin('add',x,product());else if(take('-'))x=bin('sub',x,product());else return x;}}
 const ast=sum();assert.equal(i,s.length,`Unparsed suffix: ${s.slice(i)}`);return ast;
}
// The serializer deliberately flattens ONLY consecutive additions/multiplications.
function canonical(x){
 if(x.op==='lit')return [x.op,x.i,x.j];
 if(x.op==='add'||x.op==='mul'){
  const list=[]; const flatten=n=>{if(n.op===x.op){flatten(n.a);flatten(n.b);}else list.push(canonical(n));};flatten(x);return [x.op,...list];
 }
 return x.b?[x.op,canonical(x.a),canonical(x.b)]:[x.op,canonical(x.a)];
}
// Parse text independently using ordinary infix precedence and right-associative
// powers. Read digits in slot order, so equal digits cannot mask a changed AST.
function parseText(text,code){
 const s=text.replace(/\s+/g,'').replace(/−/g,'-').replace(/[×x]/g,'*').replace(/÷/g,'/');
 let i=0,slot=0;
 const take=x=>s.startsWith(x,i)?(i+=x.length,true):false;
 const need=x=>assert.ok(take(x),`Expected ${x} at ${i}: ${s}`);
 const bin=(op,a,b)=>({op,a,b}),un=(op,a)=>({op,a});
 function atom(){
  if(take('(')){const x=sum();need(')');return x;}
  if(take('√'))return un('sqrt',atom());
  const start=slot;
  while(i<s.length && /\d/.test(s[i])){assert.equal(s[i++],code[slot++]);}
  assert.ok(slot>start,`Expected digit at ${i}: ${s}`);
  return {op:'lit',i:start,j:slot};
 }
 function fact(){let x=atom();while(take('!'))x=un('fact',x);return x;}
 function pow(){let x=fact();if(take('^'))x=bin('pow',x,unary());return x;}
 function unary(){return take('-')?un('neg',unary()):pow();}
 function product(){let x=unary();while(true){if(take('*'))x=bin('mul',x,unary());else if(take('/'))x=bin('div',x,unary());else return x;}}
 function sum(){let x=product();while(true){if(take('+'))x=bin('add',x,product());else if(take('-'))x=bin('sub',x,product());else return x;}}
 const ast=sum();assert.equal(i,s.length,`Unparsed suffix: ${s.slice(i)}`);assert.equal(slot,4);return ast;
}
const profiles=[{oldstyle:false,centerOperators:true},{oldstyle:true,centerOperators:false}];
// A radical power needs no visible parentheses; the bar groups its base.
const rootPower=table.minutes['0220'][33];
for(const structureMotion of [false,true]) {
 const tex=E.expressionTex(rootPower,'0220',{structureMotion});
 assert.doesNotMatch(tex,/\\left\(|fc-struct-paren/);
 assert.deepEqual(parse(tex),rootPower);
}
assert.equal(E.compact(rootPower,'0220'),'0!+(√(√2))^20');
let equations=0,serializations=0,textSerializations=0,rest=0;
const start=Date.now();
function roundtrip(ast,code){
 for(const text of [E.plain(ast,code),E.plain(ast,code,{division:'/'}),E.compact(ast,code)]){
  assert.deepEqual(canonical(parseText(text,code)),canonical(ast),`${code}: ${text}`);
  assert.ok(!text.includes('!!'));textSerializations++;
 }
 for(const profile of profiles)for(const division of ['fraction','inline','slash'])for(const symbolMotion of [false,true])for(const structureMotion of [false,true])for(const symbolMorph of [false,true]){
  const opt={...profile,division,symbolMotion,structureMotion,symbolMorph},tex=E.expressionTex(ast,code,opt), parsed=parse(tex);
  assert.deepEqual(canonical(parsed),canonical(ast),`${code}: ${tex}`);
  assert.ok(!tex.includes('!!'));
  assert.deepEqual([...tex.matchAll(/\{fc-d(\d)\}/g)].map(m=>+m[1]),[0,1,2,3]);
  serializations++;
 }
}
for(const [code,seconds] of Object.entries(table.minutes)){
 D.normalizeMinute({schema:D.SCHEMA,hhmm:code,seconds},code);
 seconds.forEach((ast,sec)=>{
  if(!ast){rest++;return;}
  if(!solver.verify(ast,[...code].map(Number),sec))extended.push({code,second:sec,ast});
  roundtrip(ast,code);equations++;
 });
}
// The generator's limits are search budgets, not the external AST's value domain.
// Check unsupported values symbolically without approximate equality or skipped cases.
const exact=verifyExact(extended);
exact.results.forEach((result,i)=>assert.ok(result.valid,`${extended[i].code}:${extended[i].second}: ${result.reason}`));
// Random shapes include operators that the cost-limited generator may not choose.
let seed=20260908;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const choose=xs=>xs[Math.floor(random()*xs.length)];
function tree(i,j){
 let x;
 if(j-i===1 || random()<.18)x={op:'lit',i,j};
 else{const k=i+1+Math.floor(random()*(j-i-1));x={op:choose(['add','sub','mul','div','pow']),a:tree(i,k),b:tree(k,j)};}
 for(let k=0;k<2&&random()<.38;k++)x={op:choose(['sqrt','neg','fact']),a:x};
 return x;
}
const fuzz=5000;for(let k=0;k<fuzz;k++)roundtrip(tree(0,4),'1234');
const L=i=>({op:'lit',i,j:i+1});
assert.throws(()=>E.validateAst({op:'add',a:L(0),b:L(0)},'1234'));
assert.throws(()=>D.normalizeMinute({schema:D.SCHEMA,hhmm:'1234',seconds:Array(60)},'1234'));
assert.throws(()=>D.normalizeMinute({schema:D.SCHEMA,hhmm:'1234',seconds:Array(59).fill(null)},'1234'));
assert.throws(()=>D.normalizeMinute({schema:D.SCHEMA,hhmm:'1235',seconds:Array(60).fill(null)},'1234'));
assert.throws(()=>E.validateAst({op:'lit',i:0,j:4},'0000'));
assert.throws(()=>E.validateAst({op:'tex',source:'1+2+3+4'},'1234'));
let cycle={op:'neg'};cycle.a=cycle;assert.throws(()=>E.validateAst(cycle,'1234'));
for(const code of ['2400','2360','123','1234x'])assert.throws(()=>E.assertCode(code));
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
assert.ok(!html.includes('function createSolver'));
const b64=html.match(/data-encoding="gzip-base64">([^<]+)/)[1];
assert.deepEqual(JSON.parse(zlib.gunzipSync(Buffer.from(b64,'base64'))),table);
const report={build:'r6-minimal',minutes:Object.keys(table.minutes).length,equations,rest,fuzzTrees:fuzz,checkedSerializations:serializations,textSerializations,profiles:2,divisionModes:3,boundedVerified:equations-extended.length,symbolicallyVerified:extended.length,sympy:exact.sympy,elapsedMs:Date.now()-start};
require('./report.cjs')('expression-results.json',report);console.log(report);
module.exports={parse,canonical};
