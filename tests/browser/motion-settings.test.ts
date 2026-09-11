import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import * as playwright from 'playwright';
import type { DisplayOptions, GlyphDiagnostic } from '../../src/shared/types.ts';
import {
  browserArgs,
  createReport,
  playwrightVersion,
  zip,
  combinations,
} from '../helpers/browser.ts';
const args = browserArgs(import.meta.url, {
  browsers: ['chromium', 'firefox', 'webkit'],
  options: [],
});
test('motion-settings', { timeout: 900000 }, async (t) => {
  const keys = ['symbolMotion', 'structureMotion', 'symbolMorph'];
  const selectors = ['#symbol-motion', '#structure-motion', '#symbol-morph'];
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    playwright: playwrightVersion,
    url: args.url,
    checks: [],
  });
  const errors: string[] = [];
  const browser = await playwright[args.browser].launch();
  t.after(() => browser.close());
  report['browserVersion'] = browser.version();
  const page = await browser.newPage({
    locale: 'ja-JP',
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Tokyo',
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  async function ready() {
    await page.waitForFunction(
      'window.FormulaClock?.state.engineReady && FormulaClock.state.layout',
      undefined,
      { timeout: 35000 },
    );
  }
  async function check(bits: readonly boolean[], saved = false) {
    const active = [bits[0], bits[0] && bits[1], bits[0] && bits[2]];
    await page.waitForFunction(
      script(
        '(opts)=>Object.entries(opts).every(([k,v])=>FormulaClock.state.layout.display[k]===v)',
      ),
      Object.fromEntries(zip(keys, active)),
    );
    assert.deepEqual(
      await page.evaluate(script('(keys)=>keys.map(k=>FormulaClock.state.display[k])'), keys),
      Array.from(bits),
    );
    for (const [selector, checked, disabled] of zip(selectors, bits, [false, !bits[0], !bits[0]])) {
      assert.deepEqual(await page.locator(selector).isChecked(), checked);
      assert.deepEqual(await page.locator(selector).isDisabled(), disabled);
    }
    if (saved) {
      assert.deepEqual(
        await page.evaluate(
          script(
            '(keys)=>{const s=JSON.parse(localStorage.getItem("formula-clock-display-v2"));return keys.map(k=>s[k])}',
          ),
          keys,
        ),
        Array.from(bits),
      );
    }
  }
  async function display(opts: Partial<DisplayOptions>) {
    await page.evaluate(script('(opts)=>FormulaClock.setDisplay(opts)'), opts);
  }
  async function preview(time: string) {
    await page.evaluate(
      script('(time)=>FormulaClock.preview("2026-09-09T"+time+"+09:00",true)'),
      time,
    );
    await page.waitForFunction(
      script(
        '([c,s])=>FormulaClock.state.layout.code===c && FormulaClock.state.layout.seconds===s && !document.querySelector("#stage").classList.contains("loading")',
      ),
      [time.slice(0, 2) + time.slice(3, 5), Number(time.slice(6))],
    );
  }
  await page.goto(args.url);
  await ready();
  report['mathjax'] = await page.evaluate('FormulaClock.diagnostics().mathjax');
  assert.deepEqual(report['mathjax'], '4.1.3');
  await preview('12:34:08');
  await page.click('#settings-open');
  await page.click('#advanced-settings summary');
  assert.deepEqual(await page.locator('#engine-status,.experimental-option small').count(), 0);
  assert.notDeepEqual(await page.locator('#render-status').getAttribute('hidden'), null);
  assert.ok(!(await page.locator('#advanced-settings').innerText()).includes('MathJax'));
  await check([true, true, true]);
  assert.deepEqual(await page.evaluate('localStorage.getItem("formula-clock-display-v2")'), null);
  await page.screenshot({ path: String(path.join(args.outputDir, 'desktop-defaults.png')) });
  report['checks'].push(
    'All three experimental options are enabled by default without writing saved preferences',
  );
  await display({ symbolMotion: false, structureMotion: false, symbolMorph: false });
  await check([false, false, false], true);
  await page.screenshot({ path: String(path.join(args.outputDir, 'desktop-disabled.png')) });
  for (const [index, bits] of [
    [0, [true, false, false]] as const,
    [2, [true, false, true]] as const,
    [1, [true, true, true]] as const,
  ]) {
    await page.check(selectors[index]);
    await check(bits, true);
  }
  await page.uncheck(selectors[1]);
  await check([true, false, true], true);
  await page.check(selectors[1]);
  await check([true, true, true], true);
  await page.uncheck(selectors[2]);
  await check([true, true, false], true);
  await page.check(selectors[2]);
  await check([true, true, true], true);
  await page.uncheck(selectors[0]);
  await check([false, true, true], true);
  await page.screenshot({ path: String(path.join(args.outputDir, 'desktop-suspended.png')) });
  await page.check(selectors[0]);
  await check([true, true, true], true);
  await page.uncheck(selectors[1]);
  await check([true, false, true], true);
  await page.uncheck(selectors[0]);
  await check([false, false, true], true);
  await page.keyboard.press('Escape');
  await page.reload();
  await ready();
  await check([false, false, true]);
  await display({ symbolMotion: true });
  await check([true, false, true], true);
  report['checks'].push(
    'Structure and morph remain independent; disabling basic motion retains checked values while disabling controls and rendering; reload preserves them and re-enabling basic motion restores the chosen combination',
  );
  // All eight stored combinations are valid preferences. Only the render
  // settings mask the optional motions when their prerequisite is disabled.
  const migrations: unknown[] = [];
  for (const [basic, structure, morph] of combinations([false, true], 3)) {
    const raw = Object.fromEntries(zip(keys, [basic, structure, morph]));
    await page.evaluate(
      script('(raw)=>localStorage.setItem("formula-clock-display-v2",JSON.stringify(raw))'),
      raw,
    );
    await page.reload();
    await ready();
    const expected = [basic, structure, morph];
    await check(expected);
    await display({ ...raw });
    await check(expected, true);
    migrations.push({
      saved: raw,
      effective: Object.fromEntries(zip(keys, [basic, basic && structure, basic && morph])),
    });
  }
  report['restoredCombinations'] = migrations;
  for (const [raw, expected] of [
    [{}, [true, true, true]] as const,
    [{ symbolMotion: false }, [false, true, true]] as const,
    [{ structureMotion: false }, [true, false, true]] as const,
    [{ symbolMorph: false }, [true, true, false]] as const,
  ]) {
    await page.evaluate(
      script('(raw)=>localStorage.setItem("formula-clock-display-v2",JSON.stringify(raw))'),
      raw,
    );
    await page.reload();
    await ready();
    await check(expected);
    assert.deepEqual(
      await page.evaluate<DisplayOptions>(
        'JSON.parse(localStorage.getItem("formula-clock-display-v2"))',
      ),
      raw,
    );
  }
  report['checks'].push(
    'Missing preferences default to on; explicitly saved off selections survive unchanged',
  );
  report['checks'].push(
    'All eight saved/API preference combinations retain their values; layout settings mask inactive motions; invalid option types still reject',
  );
  const before = await page.evaluate<DisplayOptions>('FormulaClock.state.display');
  assert.ok(
    await page.evaluate(
      script(`async()=>{
      try {await FormulaClock.setDisplay({symbolMotion:false,structureMotion:'invalid',symbolMorph:true});return false;}
      catch(e){return e instanceof TypeError;}
    }`),
    ),
  );
  assert.deepEqual(await page.evaluate<DisplayOptions>('FormulaClock.state.display'), before);
  await page.evaluate(
    'window.originalDigits=FormulaClock.digits;window.originalEqual=document.querySelector("#equal-sign")',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [font, numerals] of [
    ['stix2', 'oldstyle'] as const,
    ['termes', 'lining'] as const,
    ['fira', 'oldstyle'] as const,
    ['euler', 'lining'] as const,
  ]) {
    await display({
      font: font,
      numerals: numerals,
      symbolMotion: true,
      structureMotion: true,
      symbolMorph: true,
    });
    for (const time of ['12:34:08', '12:34:59', '00:00:08']) {
      await preview(time);
      await page.waitForFunction(
        script(
          '([f,n])=>FormulaClock.state.layout.display.font===f && FormulaClock.state.layout.display.numerals===n',
        ),
        [font, numerals],
      );
      assert.ok(!(await page.evaluate('FormulaClock.state.engineError')));
      assert.ok(
        (await page.evaluate<GlyphDiagnostic[]>('FormulaClock.diagnostics().glyphs'))
          .map((g) => g['inStage'])
          .every(Boolean),
      );
      assert.notDeepEqual(await page.locator('#render-status').getAttribute('hidden'), null);
    }
  }
  report['checks'].push(
    'Fractions, powers and plain time work across all four font families with persistent digits; normal render status remains hidden',
  );
  // Trigger a real same-gap + to × morph, then disable each stage while it runs.
  await page.evaluate(
    script(`()=>{
      const L=i=>({op:'lit',i,j:i+1}),B=(op,a,b)=>({op,a,b});
      const formulas={10:B('add',B('add',B('add',L(0),L(1)),L(2)),L(3)),
        9:B('add',B('add',B('mul',L(0),L(1)),L(2)),L(3))};
      FormulaClock.setDataProvider({async getMinute(hhmm){return {schema:'formula-clock/1',hhmm,
        seconds:Array.from({length:60},(_,s)=>hhmm==='1234'?formulas[s]||null:null)};}});
    }`),
  );
  await display({ font: 'stix2', numerals: 'oldstyle' });
  for (const [disabledKey, expected, count] of [
    ['symbolMorph', [true, true, false], 3] as const,
    ['structureMotion', [true, false, true], 3] as const,
    ['symbolMotion', [false, true, true], 0] as const,
  ]) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await display({ symbolMotion: true, structureMotion: true, symbolMorph: true });
    await preview('12:34:10');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // The media-change handler redraws instantly; let it finish before
    // starting the animation whose interruption we are measuring.
    await page.waitForTimeout(100);
    await preview('12:34:09');
    await page.waitForFunction('document.querySelector("[data-morphing]")', undefined);
    await display({ [disabledKey]: false });
    await check(expected, true);
    await page.waitForTimeout(750);
    assert.deepEqual(await page.locator('[data-morphing],[data-morph-glyph]').count(), 0);
    assert.deepEqual(await page.locator('#operator-root > g').count(), count);
    assert.ok(
      await page.evaluate(
        'FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && document.querySelector("#equal-sign")===originalEqual',
      ),
    );
  }
  report['checks'].push(
    'Changing each setting during an active morph settles without temporary glyphs and preserves digit/equality nodes; disabling basic motion removes moving symbols without erasing the optional preferences',
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.click('#settings-open');
  await page.click('#advanced-settings summary');
  await page.locator('#settings').evaluate(script('(el)=>el.scrollTop=0'));
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  assert.ok(
    (await page.locator('#structure-motion').isDisabled()) &&
      (await page.locator('#symbol-morph').isDisabled()),
  );
  assert.ok(
    Number(
      await page
        .locator('#structure-motion')
        .evaluate(script('(el)=>getComputedStyle(el.closest("label")).opacity')),
    ) < 0.6,
  );
  await page.screenshot({ path: String(path.join(args.outputDir, 'mobile-disabled.png')) });
  await page.check('#symbol-motion');
  await check([true, true, true], true);
  await page.keyboard.press('Escape');
  await preview('12:34:10');
  await page.waitForTimeout(750);
  await preview('12:34:09');
  await page.waitForFunction('document.querySelector("[data-morphing]")', undefined);
  await page.waitForTimeout(750);
  report['checks'].push(
    'Checked-and-disabled mobile controls retain their values; re-enabling the parent restores actual arithmetic morphing',
  );
  // Keep actionable fallback diagnostics after removing the engine banner.
  await page.evaluate(
    script(`()=>{
      const prototype=FormulaTypesetter.Typesetter.prototype;window.originalFrame=prototype.frame;
      prototype.frame=function(ast,...args){return ast?Promise.reject(new Error('Injected expression failure')):originalFrame.call(this,ast,...args);};
      FormulaClock.setDisplay({});
    }`),
  );
  await page.waitForFunction(
    'FormulaClock.state.engineError?.includes("Injected expression failure") && FormulaClock.state.layout.mode==="time"',
    undefined,
  );
  assert.deepEqual(await page.locator('#render-status').getAttribute('hidden'), null);
  assert.ok((await page.locator('#render-status').textContent())!.includes('通常の時計'));
  await page.evaluate(
    'FormulaTypesetter.Typesetter.prototype.frame=originalFrame;FormulaClock.setDisplay({})',
  );
  await page.waitForFunction(
    '!FormulaClock.state.engineError && FormulaClock.state.layout.mode==="formula"',
    undefined,
  );
  assert.notDeepEqual(await page.locator('#render-status').getAttribute('hidden'), null);
  const failed = await browser.newPage({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  failed.on('pageerror', (e) => errors.push(String(e)));
  await failed.route('https://cdn.jsdelivr.net/**', async (route) => await route.abort());
  await failed.goto(args.url);
  await failed.waitForFunction('window.FormulaClock?.state.engineError', undefined);
  assert.ok(await failed.locator('#plain-time').isVisible());
  assert.deepEqual(await failed.locator('#render-status').getAttribute('hidden'), null);
  assert.ok((await failed.locator('#render-status').textContent())!.includes('通常の時計'));
  report['checks'].push(
    'Mobile disabled states are muted and fit; expression failure falls back to the SVG clock and recovers; CDN failure keeps the plain clock and failure message',
  );
  await failed.close();
  assert.ok(!(errors.length > 0), inspect(errors));
  report['pageErrors'] = errors;
  await browser.close();
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
  console.log(JSON.stringify(report, null, 2));
});
