import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import type { DisplayOptions } from '../../src/shared/types.ts';
import { test, createReport, zip } from '../helpers/browser.ts';
test.use({
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Asia/Tokyo',
});
test('symbol-motion', async ({ browser, args, page }) => {
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    url: args.url,
    fonts: ['stix2', 'termes', 'fira', 'euler'] as const,
    numerals: ['lining', 'oldstyle'] as const,
    checks: [],
  });
  const errors: string[] = [];
  report['browserVersion'] = browser.version();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(args.url);
  await page.waitForFunction(
    'window.FormulaClock?.state.engineReady && FormulaClock.state.layout',
    undefined,
  );
  assert.ok(await page.evaluate('FormulaClock.state.display.symbolMotion'));
  await page.evaluate(
    'FormulaClock.setDisplay({symbolMotion:false,structureMotion:false,symbolMorph:false})',
  );
  await page.evaluate(
    "window.originalProvider=window.FORMULA_CLOCK_CONFIG?.provider || new FormulaData.TableProvider(()=>FormulaData.loadEmbedded(document.querySelector('#clock-data')))",
  );
  report['mathjax'] = await page.evaluate('FormulaClock.diagnostics().mathjax');
  assert.deepEqual(report['mathjax'], '4.1.3');
  await page.evaluate(
    'window.originalDigits=FormulaClock.digits;window.originalEqual=document.querySelector("#equal-sign")',
  );
  async function preview(time: string, wait = 720) {
    await page.evaluate(script('(time)=>FormulaClock.preview("2026-09-08T"+time+"+09:00")'), time);
    await page.waitForFunction(
      script(
        '([code,seconds])=>FormulaClock.state.layout.code===code && FormulaClock.state.layout.seconds===seconds',
      ),
      [time.slice(0, 2) + time.slice(3, 5), Number(time.slice(6, 8))],
    );
    if (wait) {
      await page.waitForTimeout(wait);
    }
  }
  async function display(opts: Partial<DisplayOptions>) {
    await page.evaluate(script('(opts)=>FormulaClock.setDisplay(opts)'), opts);
    await page.waitForFunction(
      script(
        '(opts)=>Object.entries(opts).every(([key,value])=>FormulaClock.state.layout.display[key]===value)',
      ),
      opts,
    );
    await page.waitForTimeout(720);
  }
  async function checkSymbols() {
    return await page.evaluate<Record<string, number>>(
      script(`()=>{
          const layout=FormulaClock.state.layout,expected={};
          const kinds={add:'+',sub:'−',neg:'−',mul:'×',fact:'!',...(layout.display.division==='inline'?{div:'÷'}:{})};
          function walk(ast){if(!ast)return;if(kinds[ast.op])expected[kinds[ast.op]]=(expected[kinds[ast.op]]||0)+1;if(ast.a)walk(ast.a);if(ast.b)walk(ast.b);}
          if(layout.display.symbolMotion)walk(layout.ast);
          const actual={};
          for(const el of document.querySelectorAll('#operator-root > g')){
            actual[el.dataset.kind]=(actual[el.dataset.kind]||0)+1;
            const r=el.getBoundingClientRect();
            if(!r.width || !r.height || r.right<0 || r.left>innerWidth)throw new Error('Invisible moving symbol');
            if(getComputedStyle(el.querySelector('path')).fill!=='rgb(195, 200, 186)')throw new Error('Wrong symbol color');
          }
          if(JSON.stringify(Object.entries(expected).sort())!==JSON.stringify(Object.entries(actual).sort()))throw new Error(JSON.stringify({expected,actual}));
          if(!FormulaClock.digits.every((el,i)=>el===originalDigits[i]) || document.querySelector('#equal-sign')!==originalEqual)throw new Error('Persistent digits/equality replaced');
          return actual;
        }`),
    );
  }
  // Marking a symbol must preserve MathJax spacing, glyph sizes and digit placement.
  let maxDelta = 0;
  for (const [font, numerals] of (['stix2', 'termes', 'fira', 'euler'] as const).flatMap((f) =>
    (['lining', 'oldstyle'] as const).map((n) => [f, n] as const),
  )) {
    for (const division of ['fraction', 'inline'] as const) {
      for (const time of ['12:34:08', '12:34:30', '12:34:31', '12:34:59', '16:39:19', '00:00:08']) {
        await display({ font: font, numerals: numerals, division: division, symbolMotion: false });
        await preview(time);
        const baseline = await page.evaluate<number[]>(
          'FormulaClock.state.layout.items.map(x=>x.matrix).flat()',
        );
        await display({ symbolMotion: true });
        const moved = await page.evaluate<number[]>(
          'FormulaClock.state.layout.items.map(x=>x.matrix).flat()',
        );
        const delta = Math.max(...zip(baseline, moved).map(([a, b]) => Math.abs(a - b)));
        maxDelta = Math.max(maxDelta, delta);
        assert.ok(delta < 0.12, inspect([font, division, time, delta] as const));
        await checkSymbols();
      }
    }
  }
  report['checks'].push(
    '96 font/numeral/division/time comparisons preserve digit layout within 0.12px',
  );
  report['maxMatrixDelta'] = maxDelta;
  await display({ font: 'stix2', division: 'fraction', symbolMotion: true });
  await preview('12:34:30');
  const samples = await page.evaluate<{ same: boolean; x: number; opacity: string }[]>(
    script(`async()=>{
      const plus=document.querySelector('#operator-root [data-kind="+"]'),shape=plus.firstChild,out=[];
      FormulaClock.preview('2026-09-08T12:34:31+09:00');const started=performance.now();
      while(performance.now()-started<850){await new Promise(requestAnimationFrame);out.push({same:plus.isConnected && plus.firstChild===shape,x:plus.getBoundingClientRect().x,opacity:getComputedStyle(plus).opacity});}
      return out;
    }`),
  );
  assert.ok(samples.map((x) => x['same'] && x['opacity'] === '1').every(Boolean), inspect(samples));
  assert.ok(new Set(samples.map((x) => Number(x['x'].toFixed(2)))).size > 5, inspect(samples));
  await checkSymbols();
  report['checks'].push(
    'Shared plus retains its element and glyph, moving continuously at full opacity; surplus multiplication disappears',
  );
  await page.screenshot({ path: String(path.join(args.outputDir, 'moving-symbols.png')) });
  // Reuse duplicate plus signs while one expression becomes the next.
  await preview('16:39:19');
  await page.evaluate(
    'window.oldPluses=[...document.querySelectorAll("#operator-root [data-kind=\\"+\\"]")]',
  );
  await preview('12:34:31');
  await checkSymbols();
  assert.deepEqual(await page.evaluate('oldPluses.filter(x=>x.isConnected).length'), 2);
  report['checks'].push('Two of three repeated plus signs are reused without duplicating nodes');
  // Different roles or slot attachments must fade, even when their glyphs match.
  await page.evaluate(
    script(`()=>{
      const L=i=>({op:'lit',i,j:i+1}),B=(op,a,b)=>({op,a,b}),F=i=>({op:'fact',a:L(i)});
      const formulas={
        6:B('add',B('add',B('sub',L(0),L(1)),L(2)),L(3)),
        4:B('add',B('sub',B('add',L(0),L(1)),L(2)),L(3)),
        13:B('add',B('add',B('add',L(0),L(1)),F(2)),L(3)),
        14:B('sub',B('mul',B('add',L(0),L(1)),F(2)),L(3)),
        30:B('add',B('add',B('add',L(0),L(1)),L(2)),F(3))
      };
      FormulaClock.setDataProvider({async getMinute(hhmm){return {schema:'formula-clock/1',hhmm,seconds:Array.from({length:60},(_,i)=>hhmm==='1234'?formulas[i]||null:null)};}});
    }`),
  );
  await page.waitForFunction('FormulaClock.state.coverage===5', undefined);
  for (const [font, numerals] of (['stix2', 'termes', 'fira', 'euler'] as const).flatMap((f) =>
    (['lining', 'oldstyle'] as const).map((n) => [f, n] as const),
  )) {
    await display({ font: font, numerals: numerals });
    await preview('12:34:06');
    await page.evaluate(
      script(`()=>{
          window.oldMinus=document.querySelector('[data-site="sub-b1-0"]');
          window.oldPlus=document.querySelector('[data-site="add-b2-0"]');
          window.fixedPlus=document.querySelector('[data-site="add-b3-0"]');
        }`),
    );
    await preview('12:34:04');
    await checkSymbols();
    assert.ok(
      await page.evaluate('!oldMinus.isConnected && !oldPlus.isConnected && fixedPlus.isConnected'),
    );
    assert.deepEqual(await page.locator('[data-site="add-b1-0"]').count(), 1);
    assert.deepEqual(await page.locator('[data-site="sub-b2-0"]').count(), 1);
    await preview('12:34:13');
    await page.evaluate(
      'window.oldFactorial=document.querySelector(\'[data-site="fact-u23-0"]\');window.factorialShape=oldFactorial.firstChild',
    );
    await preview('12:34:14');
    await checkSymbols();
    assert.ok(
      await page.evaluate('oldFactorial.isConnected && oldFactorial.firstChild===factorialShape'),
    );
    await preview('12:34:30');
    await checkSymbols();
    assert.ok(await page.evaluate('!oldFactorial.isConnected'));
    assert.deepEqual(await page.locator('[data-site="fact-u34-0"]').count(), 1);
  }
  report['checks'].push(
    'Swapped plus/minus are replaced at their gaps; factorial stays with its operand and is replaced when attachment changes, in all four fonts and both numeral styles',
  );
  await page.evaluate('FormulaClock.setDataProvider(originalProvider)');
  await page.waitForFunction('FormulaClock.state.coverage>10', undefined);
  // Interrupt movement and fades repeatedly, including hour changes and time-only frames.
  for (const i of Array.from({ length: 36 }, (_, i) => i)) {
    await preview(['12:34:30', '12:34:31', '16:39:19', '00:00:08'][i % 4], 0);
  }
  await page.waitForTimeout(800);
  await checkSymbols();
  await preview('12:34:31');
  await display({ symbolMotion: false });
  assert.deepEqual(await page.locator('#operator-root > g').count(), 0);
  await checkSymbols();
  report['checks'].push(
    'Rapid previews and disabling the experiment leave no stale or duplicate glyphs',
  );
  await page.click('#settings-open');
  if ((await page.locator('#advanced-settings').getAttribute('open')) === null) {
    await page.click('#advanced-settings summary');
  }
  await page.check('#symbol-motion');
  await page.keyboard.press('Escape');
  await page.waitForFunction('FormulaClock.state.layout.display.symbolMotion', undefined);
  await page.waitForTimeout(750);
  await checkSymbols();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await preview('12:34:59', 60);
  await checkSymbols();
  assert.deepEqual(
    await page
      .locator('#operator-root')
      .evaluate(script('(el)=>el.getAnimations({subtree:true}).length')),
    0,
  );
  await page.reload();
  await page.waitForFunction(
    'FormulaClock.state.engineReady && FormulaClock.state.layout',
    undefined,
  );
  await page.waitForTimeout(750);
  assert.ok(await page.evaluate('FormulaClock.state.display.symbolMotion'));
  report['checks'].push(
    'Settings switch persists across reload; reduced motion immediately places symbols',
  );
  assert.ok(!(errors.length > 0), inspect(errors));
  report['pageErrors'] = errors;
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
