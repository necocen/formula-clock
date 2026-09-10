import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initRenderer,renderSvg,pngFromSvg,renderDefaultOg} from '../worker/render.ts';
import samples from './og-cases.cjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(root,process.env.OG_TEST_OUTPUT || 'test-results/share-og');
const table=JSON.parse(await fs.readFile(path.join(root,'data/expressions.json'),'utf8'));
await initRenderer(await fs.readFile(path.join(root,'node_modules/@resvg/resvg-wasm/index_bg.wasm')));
function assertPng(bytes) {
  const png=Buffer.from(bytes);
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
}
test('all four fonts and independent styles render complete, bounded OG images',async()=>{
  await fs.mkdir(output,{recursive:true});
  const cases=[];
  for(const font of ['stix2','termes','fira','euler']) for(const numerals of ['oldstyle','lining'])
    for(const division of ['fraction','inline']) for(const sample of samples) {
      const state={v:1,t:sample.t,font,numerals,division},ast=table.minutes[state.t.slice(0,4)][Number(state.t.slice(4))];
      const result=await renderSvg({state,ast}),{fit,ink}=result;
      assert.ok(Math.abs(result.axisY * fit.scale + fit.y - 315) < .001);
      assert.ok(ink.x * fit.scale + fit.x >= 50 && (ink.x + ink.w) * fit.scale + fit.x <= 1150);
      assert.ok(ink.y * fit.scale + fit.y >= 130 && (ink.y + ink.h) * fit.scale + fit.y <= 500);
      assert.ok(result.slots.every(paths=>paths.length>0));
      assert.equal(result.typography.axisMode,numerals==='lining'?'numeric':'font');
      assert.ok(result.svg.includes('id="brand"'));
      if (!ast) {
        assert.ok(!result.svg.includes('rgb('), 'Resting colors use portable SVG hex notation');
        assert.ok(result.svg.includes('color="#c8aba3"'), 'Resting hour digit retains its desaturated warm color');
      }
      const png=pngFromSvg(result.svg);assertPng(png);
      const name=`${font}-${numerals}-${division}-${sample.label}`;
      await fs.writeFile(path.join(output,name+'.png'),png);
      const {svg,...metrics}=result;
      cases.push({name,state,...metrics,bytes:png.byteLength});
    }
  assert.equal(cases.length,128);
  assertPng(renderDefaultOg());
  await fs.writeFile(path.join(output,'default.png'),renderDefaultOg());
  await fs.writeFile(path.join(output,'render-results.json'),JSON.stringify({node:process.version,mathjax:'4.1.3',resvg:'2.6.2',at:new Date().toISOString(),cases},null,2));
});
test('concurrent requests cannot mix lining calibration, fonts, or expressions',async()=>{
  const inputs=Array.from({length:16},(_,i)=>({state:{v:1,t:i%2?'163919':'123430',font:['stix2','termes','fira','euler'][i%4],
    numerals:i%2?'lining':'oldstyle',division:'fraction'}}));
  const results=await Promise.all(inputs.map(({state})=>renderSvg({state,ast:table.minutes[state.t.slice(0,4)][Number(state.t.slice(4))]})));
  results.forEach((result,i)=>{assert.equal(result.typography.profile,inputs[i].state.font);assert.equal(result.typography.numerals,inputs[i].state.numerals);});
});
