import { sharedSnapshot } from '../helpers/share-response.ts';
import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import type { Page } from '@playwright/test';
import type { Expr } from '../../src/shared/types.ts';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';
test('speculative-share', async ({ browser, args }) => {
  const report = createReport({
    command: process.argv,
    at: new Date().toISOString(),
    browser: args.browser,
    playwright: playwrightVersion,
    checks: [],
    errors: [],
  });
  async function ready(page: Page, time: string | null = null) {
    await page.waitForFunction(
      script(
        'time=>{const l=window.FormulaClock?.state.layout;return l && (!time || l.code+String(l.seconds).padStart(2,"0")===time) && !document.querySelector("#share").disabled}',
      ),
      time,
      { timeout: 45000 },
    );
  }
  async function preview(page: Page, time: string) {
    await page.evaluate(
      script('time=>FormulaClock.preview(FormulaShare.localDate(time),true)'),
      time,
    );
    await ready(page, time);
  }
  report['browserVersion'] = browser.version();
  const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.addInitScript(`window.posts=[];window.nativeCalls=[];window.releaseSaves=[];window.saveMode='hold';
      const originalFetch=fetch;
      window.fetch=async function(input,init){
        if(String(input?.url||input)!=='/api/shares') return originalFetch(input,init);
        const entry={state:JSON.parse(init.body),started:performance.now(),finished:false};posts.push(entry);
        const mode=saveMode;
        if(mode==='hold')await new Promise(resolve=>releaseSaves.push(resolve));
        try {
          const response=mode==='fail'?new Response('{}',{status:503}):await originalFetch(input,init);
          entry.status=response.status;entry.result=await response.clone().json();return response;
        } finally {entry.finished=true;entry.finishedAt=performance.now();}
      };
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
        nativeCalls.push({...data,at:performance.now(),activation:navigator.userActivation.isActive,
          state:FormulaClock.state.layout});return Promise.resolve();
      }});
      addEventListener('DOMContentLoaded',()=>{
        const button=document.querySelector('#share');
        if(!button)return;
        button.addEventListener('click',()=>{window.clickStart=performance.now();window.beforeClick=nativeCalls.length;},true);
        button.addEventListener('click',()=>{window.synchronousShare=nativeCalls.length===beforeClick+1;});
      });
    `);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report['errors'].push(String(e)));
  await page.goto(args.url + '?t=123430', { waitUntil: 'domcontentloaded' });
  await ready(page, '123430');
  await page.waitForFunction('posts.length===1', undefined);
  assert.deepEqual(
    await page.evaluate('posts[0].state.ast'),
    await page.evaluate<Expr | null>('FormulaClock.state.layout.ast'),
  );
  assert.deepEqual(await page.locator('#share-status').innerText(), '');
  assert.deepEqual(await page.locator('#share').getAttribute('aria-busy'), null);
  assert.ok(page.url().endsWith('?t=123430'));
  await page.click('#share');
  assert.ok(
    (await page.evaluate<number>('posts.length')) === 1 &&
      (await page.evaluate<number>('nativeCalls.length')) === 0,
  );
  await page.evaluate('releaseSaves.splice(0).forEach(resolve=>resolve())');
  await page.waitForFunction('nativeCalls.length===1', undefined);
  await ready(page, '123430');
  report['checks'].push(
    'A paused frame saves before clicking without busy UI; a click joins the same pending request',
  );
  await page.evaluate('saveMode="normal"');
  await preview(page, '123431');
  await page.waitForFunction('posts.some(p=>p.state.t==="123431" && p.finished)', undefined);
  let before = await page.evaluate<number>('posts.length');
  await page.click('#share');
  assert.ok(await page.evaluate('synchronousShare && nativeCalls.at(-1).activation'));
  assert.deepEqual(await page.evaluate<number>('posts.length'), before);
  report['readyClickMs'] = await page.evaluate('nativeCalls.at(-1).at-clickStart');
  report['preparationMs'] = await page.evaluate(
    '(()=>{const p=posts.find(p=>p.state.t==="123431");return p.finishedAt-p.started;})()',
  );
  const savedUrl = await page.evaluate<string>('nativeCalls.at(-1).url');
  const html = await (await ctx.request.get(savedUrl)).text();
  const stored = sharedSnapshot(html);
  assert.deepEqual(stored, await page.evaluate('posts.at(-1).state'));
  report['checks'].push(
    'A completed speculative save opens native sharing synchronously with the exact saved AST',
  );
  await page.evaluate('saveMode="fail"');
  await preview(page, '123432');
  await page.waitForFunction('posts.some(p=>p.state.t==="123432" && p.finished)', undefined);
  await page.waitForTimeout(500);
  assert.deepEqual(await page.locator('#share-status').innerText(), '');
  assert.deepEqual(await page.evaluate('posts.filter(p=>p.state.t==="123432").length'), 1);
  await page.evaluate('saveMode="hold"');
  let count = await page.evaluate<number>('nativeCalls.length');
  await page.click('#share');
  assert.deepEqual(await page.evaluate('posts.filter(p=>p.state.t==="123432").length'), 2);
  assert.deepEqual(await page.evaluate<number>('nativeCalls.length'), count);
  await page.evaluate('releaseSaves.splice(0).forEach(resolve=>resolve())');
  await page.waitForFunction(script('count=>nativeCalls.length===count+1'), count);
  await ready(page, '123432');
  report['checks'].push(
    'Speculative failure stays quiet without retries in a loop; a real click retries successfully',
  );
  await page.evaluate(
    'saveMode="normal";for(const t of ["123433","123434","123435"])FormulaClock.preview(FormulaShare.localDate(t),true)',
  );
  await ready(page, '123435');
  await page.waitForFunction('posts.some(p=>p.state.t==="123435" && p.finished)', undefined);
  assert.deepEqual(
    await page.evaluate('posts.filter(p=>["123433","123434"].includes(p.state.t)).length'),
    0,
  );
  await page.evaluate('saveMode="hold"');
  await preview(page, '123436');
  await page.waitForFunction('posts.some(p=>p.state.t==="123436")', undefined);
  count = await page.evaluate<number>('nativeCalls.length');
  await preview(page, '123437');
  await page.waitForFunction('posts.some(p=>p.state.t==="123437")', undefined);
  await page.evaluate('releaseSaves.splice(0).forEach(resolve=>resolve())');
  await page.waitForFunction(
    'posts.filter(p=>["123436","123437"].includes(p.state.t)).every(p=>p.finished)',
    undefined,
  );
  assert.ok(
    (await page.evaluate<number>('nativeCalls.length')) === count &&
      (await page.locator('#share-dialog').isHidden()),
  );
  assert.deepEqual(await page.locator('#share-status').innerText(), '');
  await page.click('#share');
  assert.ok(await page.evaluate('synchronousShare'));
  assert.deepEqual(await page.evaluate('nativeCalls.at(-1).state.seconds'), 37);
  report['checks'].push(
    'Quick time changes coalesce; cancelled speculative responses cannot share an obsolete frame',
  );
  await page.mouse.move(1, 1);
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.evaluate('saveMode="normal"');
  await page.waitForTimeout(1200);
  assert.deepEqual(await page.evaluate<number>('posts.length'), 0);
  await page.evaluate('FormulaClock.preview(FormulaShare.localDate("123430"),false)');
  await ready(page, '123430');
  await page.hover('#share');
  await page.waitForFunction('posts.length===3 && posts.every(p=>p.finished)', undefined);
  assert.ok(!(await page.evaluate('FormulaClock.state.paused')));
  assert.deepEqual(await page.evaluate('posts.map(p=>p.state.t)'), ['123430', '123431', '123432']);
  await page.waitForFunction('FormulaClock.state.layout.seconds===31', undefined);
  await page.click('#share');
  assert.ok(await page.evaluate('synchronousShare && nativeCalls.at(-1).state.seconds===31'));
  assert.deepEqual(await page.evaluate('posts.filter(p=>p.state.t==="123431").length'), 1);
  report['boundaryClickMs'] = await page.evaluate('nativeCalls.at(-1).at-clickStart');
  await page.mouse.move(1, 1);
  await page.locator('#share').blur();
  await page.evaluate('FormulaClock.live()');
  await ready(page);
  before = await page.evaluate<number>('posts.length');
  await page.waitForTimeout(2200);
  assert.deepEqual(await page.evaluate<number>('posts.length'), before);
  report['checks'].push(
    'The running clock writes nothing without intent; a hover warms only three frames and a next-second click uses the matching id',
  );
  report['mathjax'] = await page.evaluate('FormulaClock.diagnostics().mathjax');
  assert.deepEqual(report['mathjax'], '4.1.3');
  await ctx.close();
  assert.ok(!(report['errors'].length > 0), inspect(report['errors']));
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
