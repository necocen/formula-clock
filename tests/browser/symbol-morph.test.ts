import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import * as playwright from 'playwright';
import type { DisplayOptions } from '../../src/shared/types.ts';
import { browserArgs, createReport, playwrightVersion, zip, sorted } from '../helpers/browser.ts';
interface GlyphBounds {
  key: string;
  box: number[];
}
interface MorphPart {
  kind: string;
  angle: number;
  opacity: number;
}
interface MorphSample {
  alive: boolean;
  kind: string;
  morphing: boolean;
  parts: MorphPart[];
}
const args = browserArgs(import.meta.url, {
  browsers: ['chromium', 'firefox', 'webkit'],
  options: [],
});
test('symbol-morph', { timeout: 900000 }, async (t) => {
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    url: args.url,
    playwright: playwrightVersion,
    fonts: ['stix2', 'termes', 'fira', 'euler'] as const,
    numerals: ['lining', 'oldstyle'] as const,
    checks: [],
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  const browser = await playwright[args.browser].launch();
  t.after(() => browser.close());
  report['browserVersion'] = browser.version();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Tokyo',
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => (msg.type() === 'warning' ? warnings.push(msg.text()) : null));
  await page.goto(args.url);
  await page.waitForFunction(
    'window.FormulaClock?.state.engineReady && FormulaClock.state.layout',
    undefined,
  );
  report['mathjax'] = await page.evaluate('FormulaClock.diagnostics().mathjax');
  assert.deepEqual(report['mathjax'], '4.1.3');
  assert.ok(await page.evaluate('FormulaClock.state.display.symbolMorph'));
  await page.evaluate(
    'FormulaClock.setDisplay({symbolMotion:false,structureMotion:false,symbolMorph:false})',
  );
  await page.evaluate(
    script(`()=>{
      window.originalDigits=FormulaClock.digits;window.originalEqual=document.querySelector('#equal-sign');
      window.geometry=()=>[...document.querySelectorAll('#math-scene path,#math-scene rect')].map(el=>{
        const r=el.getBoundingClientRect();return {key:el.localName==='path'?el.getAttribute('d'):'rule',box:[r.x,r.y,r.width,r.height]};
      }).filter(x=>x.key&&x.box[2]&&x.box[3]).sort((a,b)=>a.key.localeCompare(b.key)||a.box[0]-b.box[0]||a.box[1]-b.box[1]);
      window.morphSample=el=>({alive:el.isConnected,kind:el.dataset.kind,morphing:!!el.dataset.morphing,
        parts:[...el.querySelectorAll('[data-morph-glyph]')].map(g=>({kind:g.dataset.morphGlyph,
          angle:Number(g.getAttribute('transform').match(/rotate\\(([^)]+)\\)/)[1]),opacity:Number(g.getAttribute('opacity'))}))});
    }`),
  );
  async function display(opts: Partial<DisplayOptions>) {
    await page.evaluate(script('(opts)=>FormulaClock.setDisplay(opts)'), opts);
    await page.waitForFunction(
      script(
        '(opts)=>Object.entries(opts).every(([k,v])=>FormulaClock.state.layout.display[k]===v)',
      ),
      opts,
    );
  }
  async function preview(time: string, wait = 0) {
    await page.evaluate(script('(time)=>FormulaClock.preview("2026-09-08T"+time+"+09:00")'), time);
    await page.waitForFunction(
      script(
        '([c,s])=>FormulaClock.state.layout.code===c && FormulaClock.state.layout.seconds===s && typeof FormulaClock.state.coverage==="number" && !document.querySelector("#stage").classList.contains("loading")',
      ),
      [time.slice(0, 2) + time.slice(3, 5), Number(time.slice(6, 8))],
    );
    if (wait) {
      await page.waitForTimeout(wait);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Let any initial live frame's pre-existing fade retire.
  await page.waitForTimeout(750);
  let maxDelta = 0;
  let comparisons = 0;
  for (const [font, numerals] of (['stix2', 'termes', 'fira', 'euler'] as const).flatMap((f) =>
    (['lining', 'oldstyle'] as const).map((n) => [f, n] as const),
  )) {
    for (const division of ['fraction', 'inline'] as const) {
      for (const time of ['12:34:08', '12:34:30', '12:34:31', '12:34:59', '16:39:19', '00:00:08']) {
        await display({
          font: font,
          numerals: numerals,
          division: division,
          symbolMotion: false,
          structureMotion: false,
          symbolMorph: false,
        });
        await preview(time);
        const baseline = await page.evaluate<GlyphBounds[]>('geometry()');
        for (const [basic, structure, morph] of [
          [false, false, false] as const,
          [true, false, false] as const,
          [true, true, false] as const,
          [true, false, true] as const,
          [true, true, true] as const,
        ]) {
          await display({ symbolMotion: basic, structureMotion: structure, symbolMorph: morph });
          const actual = await page.evaluate<GlyphBounds[]>('geometry()');
          assert.deepEqual(
            baseline.map((x) => x['key']),
            actual.map((x) => x['key']),
            inspect([
              font,
              division,
              time,
              basic,
              structure,
              morph,
              baseline.length,
              actual.length,
            ] as const),
          );
          const delta = Math.max(
            ...zip(baseline, actual).flatMap(([x, y]) =>
              zip(x['box'], y['box']).map(([a, b]) => Math.abs(a - b)),
            ),
          );
          assert.ok(
            delta < 0.12,
            inspect([font, division, time, basic, structure, morph, delta] as const),
          );
          maxDelta = Math.max(maxDelta, delta);
          comparisons += 1;
        }
      }
    }
  }
  report['geometryComparisons'] = comparisons;
  report['maxGlyphBoundsDeltaPx'] = maxDelta;
  report['checks'].push(
    'Every settled glyph/rule matches the original layout across all five permitted motion combinations in all four fonts and both numeral styles/division styles',
  );
  await page.evaluate(
    script(`()=>{
      const L=i=>({op:'lit',i,j:i+1}),B=(op,a,b)=>({op,a,b});
      const formulas={
        10:B('add',B('add',B('add',L(0),L(1)),L(2)),L(3)),
        9:B('add',B('add',B('mul',L(0),L(1)),L(2)),L(3)),
        13:B('add',B('mul',B('add',L(0),L(1)),L(2)),L(3)),
        6:B('add',B('add',B('sub',L(0),L(1)),L(2)),L(3)),
        24:B('mul',B('mul',B('mul',L(0),L(1)),L(2)),L(3))
      };
      // 12 op 3 + 6 gives four distinct, valid seconds at the same b2 gap.
      const arithmetic=Object.fromEntries(Object.entries({add:21,sub:15,mul:42,div:10}).map(([op,s])=>
        [s,B('add',B(op,{op:'lit',i:0,j:2},L(2)),L(3))]));
      FormulaClock.setDataProvider({async getMinute(hhmm){return {schema:'formula-clock/1',hhmm,
        seconds:Array.from({length:60},(_,s)=>(hhmm==='1234'?formulas:hhmm==='1236'?arithmetic:{})[s]||null)};}});
    }`),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const [font, numerals] of (['stix2', 'termes', 'fira', 'euler'] as const).flatMap((f) =>
    (['lining', 'oldstyle'] as const).map((n) => [f, n] as const),
  )) {
    await display({
      font: font,
      numerals: numerals,
      division: 'fraction',
      symbolMotion: true,
      structureMotion: false,
      symbolMorph: true,
    });
    await preview('12:34:10', 750);
    const samples = await page.evaluate<MorphSample[]>(
      script(`async()=>{
          const el=document.querySelector('[data-site="add-b1-0"]');window.rotating=el;
          FormulaClock.preview('2026-09-08T12:34:09+09:00');const started=performance.now(),out=[];
          while(performance.now()-started<850){await new Promise(requestAnimationFrame);out.push(morphSample(el));}return out;
        }`),
    );
    assert.ok(samples.map((s) => s['alive']).every(Boolean));
    const middle = samples.filter((s) => s['morphing']).map((s) => s);
    assert.ok(middle.length > 10);
    for (const s of middle) {
      assert.deepEqual(s['parts'].length, 2);
      const [plus, times] = sorted(s['parts'], (x) => x['kind']);
      assert.ok(Math.abs(plus['angle'] - times['angle'] - 45) < 1e-7);
      assert.ok(Math.abs(plus['opacity'] + times['opacity'] - 1) < 1e-7);
    }
    assert.ok(new Set(middle.map((s) => Number(s['parts'][0]['angle'].toFixed(1)))).size > 10);
    assert.ok(!samples.at(-1)!['morphing'] && samples.at(-1)!['kind'] === '×');
    assert.deepEqual(await page.locator('[data-morph-glyph]').count(), 0);
    // Reverse a partially completed rotation: reuse the same two glyphs.
    await preview('12:34:10', 750);
    await preview('12:34:09', 170);
    const reversal = await page.evaluate<{
      before: MorphSample;
      after: MorphSample;
      same: boolean;
    }>(
      script(`async()=>{
          const el=document.querySelector('[data-site="mul-b1-0"]'),parts=[...el.children],before=morphSample(el);
          FormulaClock.preview('2026-09-08T12:34:10+09:00');
          while(FormulaClock.state.layout.seconds!==10)await new Promise(requestAnimationFrame);
          return {before,after:morphSample(el),same:parts.every((p,i)=>p===el.children[i])};
        }`),
    );
    assert.ok(reversal['same'], inspect(reversal));
    assert.ok(
      Math.abs(reversal['after']['parts'][0]['angle'] - reversal['before']['parts'][0]['angle']) <
        8,
      inspect(reversal),
    );
    await page.waitForTimeout(760);
    assert.deepEqual(await page.locator('[data-morphing]').count(), 0);
    assert.ok(await page.evaluate("rotating.isConnected && rotating.dataset.kind==='+'"));
    // Both signs may rotate, but each keeps its own HHMM boundary.
    await preview('12:34:13', 750);
    await page.evaluate(
      'window.gap1=document.querySelector(\'[data-site="add-b1-0"]\');window.gap2=document.querySelector(\'[data-site="mul-b2-0"]\')',
    );
    await preview('12:34:09', 200);
    assert.ok(
      await page.evaluate(
        "gap1.dataset.site==='mul-b1-0' && gap2.dataset.site==='add-b2-0' && gap1.dataset.morphing && gap2.dataset.morphing",
      ),
    );
    await page.screenshot({
      path: String(path.join(args.outputDir, `rotating-${font}-${numerals}.png`)),
    });
    await preview('12:34:06', 750);
    assert.ok(await page.evaluate("gap1.isConnected && gap1.dataset.kind==='−'"));
    assert.deepEqual(await page.locator('[data-morphing]').count(), 0);
  }
  report['checks'].push(
    'Same-gap +↔× retains its group, rotates 45° around glyph centers with complementary opacity, and reverses continuously; simultaneous changes retain their own gaps',
  );
  const arithmetic = [
    ['+', 'add', 21] as const,
    ['−', 'sub', 15] as const,
    ['×', 'mul', 42] as const,
    ['÷', 'div', 10] as const,
  ];
  let directedPairs = 0;
  for (const [font, numerals] of (['stix2', 'termes', 'fira', 'euler'] as const).flatMap((f) =>
    (['lining', 'oldstyle'] as const).map((n) => [f, n] as const),
  )) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await display({
      font: font,
      numerals: numerals,
      division: 'inline',
      symbolMotion: false,
      structureMotion: false,
      symbolMorph: false,
    });
    const baseline: Record<string, GlyphBounds[]> = {};
    for (const [kind, _op, second] of arithmetic) {
      await preview(`12:36:${String(second).padStart(2, '0')}`);
      baseline[kind] = await page.evaluate<GlyphBounds[]>('geometry()');
    }
    await display({ symbolMotion: true, structureMotion: true, symbolMorph: true });
    // Warm all frames so the samples measure animation, not typesetting latency.
    for (const [_kind, _op, second] of arithmetic) {
      await preview(`12:36:${String(second).padStart(2, '0')}`);
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const [source, sourceOp, sourceSecond] of arithmetic) {
      for (const [target, _targetOp, targetSecond] of arithmetic) {
        if (source === target) {
          continue;
        }
        await preview(`12:36:${String(sourceSecond).padStart(2, '0')}`, 750);
        const samples = await page.evaluate<MorphSample[], unknown>(
          script(`async({site,second})=>{
                  const el=document.querySelector(\`[data-site="\${site}"]\`);window.arithmeticSign=el;
                  FormulaClock.preview(\`2026-09-08T12:36:\${String(second).padStart(2,'0')}+09:00\`);
                  const started=performance.now(),out=[];
                  while(performance.now()-started<760){await new Promise(requestAnimationFrame);out.push(morphSample(el));}
                  return out;
                }`),
          { site: `${sourceOp}-b2-0`, second: targetSecond },
        );
        assert.ok(
          samples.map((s) => s['alive']).every(Boolean),
          inspect([font, source, target] as const),
        );
        const middle = samples.filter((s) => s['morphing']).map((s) => s);
        assert.ok(middle.length > 8, inspect([font, source, target, middle] as const));
        for (const s of middle) {
          const parts = Object.fromEntries(s['parts'].map((part) => [part['kind'], part] as const));
          assert.deepEqual(
            new Set(Object.keys(parts)),
            new Set([source, target]),
            inspect([font, source, target, s] as const),
          );
          assert.ok(
            Math.abs(
              Object.values(parts)
                .map((p) => p['opacity'])
                .reduce((total, value) => total + value, 0) - 1,
            ) < 1e-7,
            inspect(s),
          );
          const angles = Object.values(parts).map((p) => p['angle'] + (p['kind'] === '×' ? 45 : 0));
          assert.ok(Math.max(...angles) - Math.min(...angles) < 1e-7, inspect(s));
          if (!([source, target] as const).includes('×')) {
            assert.ok(angles.map((a) => Math.abs(a) < 1e-7).every(Boolean), inspect(s));
          }
        }
        const targetOpacities = middle.map(
          (s) => s['parts'].filter((p) => p['kind'] === target).map((p) => p['opacity'])[0]!,
        );
        assert.ok(
          new Set(targetOpacities.map((v) => Number(v.toFixed(2)))).size > 8,
          inspect([font, source, target] as const),
        );
        assert.ok(!samples.at(-1)!['morphing'] && samples.at(-1)!['kind'] === target);
        const actual = await page.evaluate<GlyphBounds[]>('geometry()');
        assert.deepEqual(
          baseline[target].map((x) => x['key']),
          actual.map((x) => x['key']),
          inspect([font, source, target] as const),
        );
        const delta = Math.max(
          ...zip(baseline[target], actual).flatMap(([x, y]) =>
            zip(x['box'], y['box']).map(([a, b]) => Math.abs(a - b)),
          ),
        );
        assert.ok(delta < 0.12, inspect([font, source, target, delta] as const));
        directedPairs += 1;
      }
    }
    // A third/fourth destination keeps every still-visible glyph continuous.
    await preview('12:36:21', 750);
    await page.evaluate('window.multiSign=document.querySelector(\'[data-site="add-b2-0"]\')');
    for (const second of [42, 15, 10, 21, 10, 42, 15]) {
      const change = await page.evaluate<
        { before: MorphSample; after: MorphSample; retained: boolean },
        unknown
      >(
        script(`async(second)=>{
              const before=morphSample(multiSign),parts=[...multiSign.children];
              FormulaClock.preview(\`2026-09-08T12:36:\${String(second).padStart(2,'0')}+09:00\`);
              while(FormulaClock.state.layout.seconds!==second)await new Promise(requestAnimationFrame);
              return {before,after:morphSample(multiSign),retained:before.morphing?parts.every(p=>p.parentNode===multiSign):true};
            }`),
        second,
      );
      assert.ok(change['retained'] && change['after']['alive'], inspect(change));
      assert.ok(change['after']['parts'].length <= 4, inspect(change));
      const after = Object.fromEntries(
        change['after']['parts'].map((p) => [p['kind'], p] as const),
      );
      for (const part of change['before']['parts']) {
        assert.ok(Math.abs(part['angle'] - after[part['kind']]['angle']) < 8, inspect(change));
        assert.ok(
          Math.abs(part['opacity'] - after[part['kind']]['opacity']) < 0.2,
          inspect(change),
        );
      }
      assert.ok(
        Math.abs(
          Object.values(after)
            .map((p) => p['opacity'])
            .reduce((total, value) => total + value, 0) - 1,
        ) < 1e-7,
        inspect(change),
      );
      await page.waitForTimeout(65);
    }
    await page.waitForTimeout(750);
    assert.ok(
      await page.evaluate(
        "multiSign.isConnected && multiSign.dataset.kind==='−' && !multiSign.dataset.morphing",
      ),
    );
    assert.deepEqual(await page.locator('[data-morph-glyph]').count(), 0);
    // Fraction rules and unary signs are outside this arithmetic morph.
    await preview('12:36:10', 80);
    await display({ division: 'fraction' });
    await page.waitForTimeout(750);
    assert.ok(await page.evaluate('!multiSign.isConnected'));
    assert.deepEqual(await page.locator('[data-morph-glyph],[data-morphing]').count(), 0);
  }
  report['directedArithmeticPairs'] = directedPairs;
  report['checks'].push(
    'All 12 directed +/−/×/÷ pairs in each font/numeral combination retain their gap, crossfade continuously, keep horizontal signs level, rotate × by 45°, and settle to exact original geometry',
  );
  report['checks'].push(
    'Third/fourth destinations preserve current opacity, angle and child nodes with at most four glyphs; fraction mode retires the obelus without morphing a rule',
  );
  for (const i of Array.from({ length: 42 }, (_, i) => i)) {
    await preview(['12:34:10', '12:34:24', '12:34:13', '12:34:06'][i % 4]);
    assert.ok((await page.locator('[data-morph-glyph]').count()) <= 12);
  }
  await page.waitForTimeout(800);
  assert.deepEqual(await page.locator('[data-morph-glyph],[data-morphing]').count(), 0);
  assert.deepEqual(await page.locator('#operator-root > g').count(), 3);
  await preview('12:34:24', 100);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction('!document.querySelector("[data-morphing]")', undefined);
  assert.deepEqual(
    await page
      .locator('#operator-root')
      .evaluate(script('(el)=>el.getAnimations({subtree:true}).length')),
    0,
  );
  await preview('00:00:08');
  assert.deepEqual(await page.locator('#operator-root > g').count(), 0);
  await preview('12:34:10');
  await display({ symbolMorph: false });
  assert.deepEqual(await page.locator('#operator-root > g').count(), 3);
  assert.deepEqual(await page.locator('[data-morph-glyph],[data-morphing]').count(), 0);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.click('#settings-open');
  if ((await page.locator('#advanced-settings').getAttribute('open')) === null) {
    await page.click('#advanced-settings summary');
  }
  await page.check('#symbol-morph');
  await page.keyboard.press('Escape');
  await page.waitForFunction('FormulaClock.state.layout.display.symbolMorph', undefined);
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));
  assert.ok(
    await page.evaluate(
      'FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && document.querySelector("#equal-sign")===originalEqual',
    ),
  );
  await page.reload();
  await page.waitForFunction(
    'FormulaClock.state.engineReady && FormulaClock.state.layout',
    undefined,
  );
  assert.ok(
    await page.evaluate(
      'FormulaClock.state.display.symbolMorph && FormulaClock.state.display.symbolMotion',
    ),
  );
  assert.ok(!(errors.length > 0), inspect(errors));
  report['checks'].push(
    'Rapid interruptions keep bounded glyph layers and clean up fully; reduced motion cancels rotation/fades; null clears signs; disabling morph retains basic signs; mobile setting and its prerequisites persist',
  );
  await browser.close();
  report['pageErrors'] = errors;
  report['warnings'] = sorted(new Set(warnings));
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
  console.log(JSON.stringify(report, null, 2));
});
