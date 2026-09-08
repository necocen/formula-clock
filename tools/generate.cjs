// Offline generation only. Nothing in this file is included in the browser.
'use strict';
const fs=require('node:fs'), path=require('node:path'), zlib=require('node:zlib');
const {createSolver}=require('./solver.cjs');
const {normalizeMinute,SCHEMA}=require('../data.js');
const solver=createSolver(), minutes={};
let equations=0; const started=Date.now();
for(let m=0;m<1440;m++) {
  const code=String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0');
  const result=solver.solve(code);
  normalizeMinute({schema:SCHEMA,hhmm:code,seconds:result.solutions},code);
  result.solutions.forEach((ast,s)=>{if(ast && !solver.verify(ast,[...code].map(Number),s))throw Error(`${code}:${s} failed exact validation`);});
  minutes[code]=result.solutions; equations+=result.count;
  if(m%120===0) console.log(code,equations,`${Date.now()-started}ms`);
}
const table={schema:SCHEMA,minutes}, json=JSON.stringify(table);
fs.writeFileSync(path.join(__dirname,'../data/expressions.json'),json+'\n');
const report={minutes:1440,seconds:86400,equations,ordinaryTime:86400-equations,jsonBytes:Buffer.byteLength(json),gzipBytes:zlib.gzipSync(json,{level:9}).length,elapsedMs:Date.now()-started};
fs.writeFileSync(path.join(__dirname,'../tests/data-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(report);
