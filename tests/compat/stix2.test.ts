import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import type { Route } from 'playwright';
import type { ClockDiagnostics, DisplayOptions } from '../../src/shared/types.ts';
import { isRecord } from '../../src/shared/types.ts';
import { browserArgs, createReport, ROOT, playwrightVersion } from '../helpers/browser.ts';
import { pythonJson } from '../helpers/python.ts';

const args = browserArgs(import.meta.url, {
  browsers: ['chromium'],
  standalone: true,
  options: ['local-mathjax', 'stix-fonts'],
});

test('local STIX Two / MathJax 3 compatibility', { timeout: 300000 }, async (t) => {
  const lib = args.localMathjax;
  assert.ok(lib && args.stixFonts, 'Supply --local-mathjax DIRECTORY and --stix-fonts DIRECTORY');
  const fixture = pythonJson(new URL('./local_stix_fixture.py', import.meta.url), null, [
    args.stixFonts,
  ]);
  assert.ok(isRecord(fixture) && typeof fixture.fontVersion === 'string');
  assert.ok(typeof fixture.axis === 'number' && Number.isFinite(fixture.axis));
  for (const variant of ['normal', 'oldstyle']) {
    const chars = fixture[variant];
    assert.ok(isRecord(chars));
    for (const glyph of Object.values(chars)) {
      assert.ok(Array.isArray(glyph) && glyph.length === 4);
      assert.ok(
        glyph.slice(0, 3).every((value) => typeof value === 'number' && Number.isFinite(value)),
      );
      assert.ok(isRecord(glyph[3]) && typeof glyph[3].p === 'string');
    }
  }
  assert.ok(isRecord(fixture.oldstyle));
  const six = fixture.oldstyle['54'];
  assert.ok(Array.isArray(six) && isRecord(six[3]) && typeof six[3].p === 'string');
  const expectedSix = 'M' + six[3].p + 'Z';
  const patch = `
    const requested=window.MathJax.output.font;
    delete window.MathJax.output;
    if(requested==='mathjax-stix2'){
      const fixture=${JSON.stringify(fixture)};
      window.MathJax.startup.ready=()=>{
        MathJax.startup.defaultReady();
        const font=MathJax.startup.document.outputJax.font;
        font.defineChars('normal',fixture.normal);
        font.defineChars('-tex-oldstyle',fixture.oldstyle);
        font.params.axis_height=fixture.axis;
      };
    }
  `;
  const report = createReport({
    testEngine: 'MathJax 3 + local STIX Two glyph/metric fixture',
    compatibilityOnly: true,
    fontVersion: fixture.fontVersion,
    command: process.argv,
    playwright: playwrightVersion,
  });
  const browser = await chromium.launch();
  t.after(() => browser.close());
  report.browserVersion = browser.version();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: 'Asia/Tokyo',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(
    `localStorage.setItem('formula-clock-display-v2',JSON.stringify({symbolMotion:false,structureMotion:false,symbolMorph:false}));`,
  );
  await ctx.route('https://cdn.jsdelivr.net/**', async (route: Route) => {
    const url = route.request().url();
    if (url.endsWith('/tex-svg-nofont.js')) {
      await route.fulfill({
        contentType: 'application/javascript',
        body: patch + fs.readFileSync(path.join(lib, 'tex-svg.js'), 'utf8'),
      });
    } else {
      const file = path.join(lib, url.split('/mathjax@4.1.3/').at(-1)!);
      if (fs.existsSync(file))
        await route.fulfill({ path: file, contentType: 'application/javascript' });
      else await route.abort();
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => report.errors.push(String(error)));
  await page.goto(args.url);
  await page.waitForFunction(
    'window.FormulaClock?.state.engineReady && FormulaClock.state.layout',
    undefined,
    { timeout: 35000 },
  );
  await page.evaluate('window.originalDigits=FormulaClock.digits');
  report.mathjax = await page.evaluate('FormulaClock.diagnostics().mathjax');
  assert.ok(typeof report.mathjax === 'string' && report.mathjax.startsWith('3.'));
  assert.equal(await page.evaluate('FormulaClock.state.display.font'), 'stix2');
  async function preview(time: string) {
    await page.evaluate(script('(t)=>FormulaClock.preview("2026-09-08T"+t+"+09:00",true)'), time);
    await page.waitForFunction(
      script(
        '([c,s])=>FormulaClock.state.layout?.code===c&&FormulaClock.state.layout?.seconds===s',
      ),
      [time.slice(0, 2) + time.slice(3, 5), Number(time.slice(6))],
    );
    await page.waitForTimeout(80);
  }
  async function settings(
    font: DisplayOptions['font'],
    division: DisplayOptions['division'],
    numerals: DisplayOptions['numerals'] = 'oldstyle',
  ) {
    await page.evaluate(script('opts=>FormulaClock.setDisplay(opts)'), {
      font,
      division,
      numerals,
    });
    await page.waitForFunction(
      script(
        '([f,d,n])=>{const s=FormulaClock.state.layout?.display;return s?.font===f&&s.division===d&&s.numerals===n}',
      ),
      [font, division, numerals],
    );
    await page.waitForTimeout(80);
  }
  async function geometry() {
    const diag = await page.evaluate<ClockDiagnostics>('FormulaClock.diagnostics()');
    assert.equal(diag.engineError, null);
    assert.ok(diag.glyphs.every((glyph) => glyph.inStage));
    assert.ok(await page.evaluate('FormulaClock.digits.every((x,i)=>x===originalDigits[i])'));
    const delta = await page.evaluate<number | null>(
      script(`()=>{
      if(FormulaClock.state.layout.mode!=='formula')return null;
      const sr=document.querySelector('#stage').getBoundingClientRect();
      const paths=[...document.querySelectorAll('#equal-sign path[data-c="3D"]')];
      if(!paths.length)throw Error('Missing persistent equality');
      const rects=paths.map(p=>p.getBoundingClientRect());
      return (Math.min(...rects.map(r=>r.top))+Math.max(...rects.map(r=>r.bottom)))/2-sr.top-sr.height/2;
    }`),
    );
    if (delta !== null) assert.ok(Math.abs(delta) < 0.12);
    assert.ok(diag.typography);
    report.cases.push({
      time: diag.time,
      display: diag.display,
      axisErrorPx: delta,
      axisEm: diag.typography.axisEm,
    });
  }
  // The old "oldstyle" profile is now an independent numeral setting.
  for (const [font, numerals] of [
    ['stix2', 'oldstyle'],
    ['euler', 'oldstyle'],
    ['stix2', 'lining'],
  ] as const) {
    for (const division of ['fraction', 'inline'] as const) {
      await settings(font, division, numerals);
      for (const time of [
        '16:39:19',
        '12:34:08',
        '12:34:30',
        '12:34:31',
        '12:34:59',
        '08:59:05',
        '00:00:08',
      ]) {
        await preview(time);
        await geometry();
      }
      if (numerals === 'oldstyle')
        assert.ok(
          await page.evaluate(
            'FormulaClock.diagnostics().typography.axisEm===FormulaClock.diagnostics().typography.originalAxisEm',
          ),
        );
    }
  }
  await settings('stix2', 'fraction');
  await preview('16:39:19');
  assert.equal(
    await page.locator('#stage .digit[data-digit="1"] path').getAttribute('d'),
    expectedSix,
  );
  await page.screenshot({
    path: path.join(args.outputDir, 'stix2-local-163919.png'),
    fullPage: true,
  });
  await page
    .locator('.stage-wrap')
    .screenshot({ path: path.join(args.outputDir, 'stix2-local-equation.png') });
  await preview('12:34:59');
  await page.screenshot({
    path: path.join(args.outputDir, 'stix2-local-power.png'),
    fullPage: true,
  });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 840 });
    for (const division of ['fraction', 'inline'] as const) {
      await settings('stix2', division);
      for (const time of ['16:39:19', '12:34:59', '00:00:08']) {
        await preview(time);
        await geometry();
        assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
      }
    }
    await page.screenshot({
      path: path.join(args.outputDir, `stix2-local-mobile-${width}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(report.errors, []);
  report.checks = [
    'default STIX2',
    'exact STIX Two 6 outline',
    'font/numeral switching',
    'fraction/inline division',
    'persistent digits',
    'fixed equality axis',
    'native oldstyle axis',
    '320/390/768 layouts',
    'ordinary clock',
  ];
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(`PASS ${report.cases.length} local compatibility cases (${ROOT})`);
});
