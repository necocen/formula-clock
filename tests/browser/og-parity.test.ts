import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, inspect } from 'node:util';
import * as playwright from 'playwright';
import type { Bounds, Typography } from '../../src/shared/types.ts';
import { isRecord } from '../../src/shared/types.ts';
import Share from '../../src/shared/share.ts';
import { browserArgs, createReport, playwrightVersion } from '../helpers/browser.ts';
const args = browserArgs(import.meta.url, {
  browsers: ['chromium', 'firefox', 'webkit'],
  options: ['render-results'],
});
test('og-parity', { timeout: 900000 }, async (t) => {
  const output = args.outputDir;
  const server: unknown = JSON.parse(fs.readFileSync(args.renderResults, 'utf8'));
  assert.ok(isRecord(server) && Array.isArray(server.cases));
  assert.equal(server.cases.length, 240, 'Run npm run test:og to produce the full reference set');
  const cases: unknown[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  const browser = await playwright[args.browser].launch({ headless: true });
  t.after(() => browser.close());
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    timezoneId: 'Asia/Tokyo',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(args.url + '?t=123430', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    'window.FormulaClock?.state.layout && !document.querySelector("#share").disabled',
    undefined,
    { timeout: 45000 },
  );
  // The static renderer omits motion markers; compare the same TeX settings.
  await page.evaluate(
    'FormulaClock.setDisplay({symbolMotion:false,structureMotion:false,symbolMorph:false})',
  );
  let profile = null;
  for (const entry of server.cases) {
    const sample: unknown = entry;
    assert.ok(isRecord(sample) && isRecord(sample.state));
    assert.ok(typeof sample.name === 'string' && typeof sample.axisY === 'number');
    const state = Share.snapshot({ ...sample.state, ast: null });
    const current = [state['font'], state['numerals'], state['division']];
    if (!isDeepStrictEqual(profile, current)) {
      await page.evaluate(
        script('([font,numerals,division])=>FormulaClock.setDisplay({font,numerals,division})'),
        current,
      );
      profile = current;
    }
    const t = state['t'];
    await page.evaluate(script('(t)=>FormulaClock.preview(FormulaShare.localDate(t),true)'), t);
    await page.waitForFunction(
      script(
        's=>{const l=FormulaClock.state.layout;return l?.code===s.t.slice(0,4)&&l.seconds===Number(s.t.slice(4))&&l.display.font===s.font&&l.display.numerals===s.numerals&&l.display.division===s.division&&!document.querySelector("#share").disabled}',
      ),
      state,
      { timeout: 45000 },
    );
    const actual = await page.evaluate<{
      tex: string;
      axisY: number;
      viewBox: Bounds;
      typography: Typography;
      slots: string[][];
    }>(
      script(`() => {
          const layout=FormulaClock.state.layout;
          const slots=[...FormulaClock.digits,...document.querySelectorAll('#math-scene .answer-digit')].map(group=>[...group.querySelectorAll('path')].map(path=>path.getAttribute('d')));
          return {tex:layout.tex,axisY:layout.localAxisY,viewBox:layout.viewBox,typography:layout.typography,slots};
        }`),
    );
    assert.deepEqual(actual['tex'], sample['tex'], inspect(sample['name']));
    assert.deepEqual(actual['slots'], sample['slots'], inspect(sample['name']));
    assert.ok(
      Math.abs(actual['axisY'] - sample['axisY']) < 0.1,
      inspect([sample['name'], actual['axisY'], sample['axisY']] as const),
    );
    for (const key of ['x', 'y', 'w', 'h'] as const) {
      const viewBox = sample.viewBox;
      assert.ok(isRecord(viewBox) && typeof viewBox[key] === 'number');
      assert.ok(
        Math.abs(actual['viewBox'][key] - viewBox[key]) < 0.1,
        inspect([sample['name'], key, actual['viewBox'], sample['viewBox']] as const),
      );
    }
    for (const key of ['numericAxisEm', 'axisEm', 'equalCenterY'] as const) {
      const typography = sample.typography;
      assert.ok(isRecord(typography) && typeof typography[key] === 'number');
      assert.ok(
        Math.abs(actual['typography'][key] - typography[key]) < 0.001,
        inspect([sample['name'], key] as const),
      );
    }
    cases.push({
      name: sample['name'],
      glyphsMatch: true,
      axisDelta: actual['axisY'] - sample['axisY'],
    });
    if (
      state['division'] === 'fraction' &&
      ['123430', '100836', '022033', '085846', '004159'].includes(t)
    ) {
      await page
        .locator('#stage')
        .screenshot({ path: String(path.join(output, sample['name'] + '.png')) });
    }
  }
  const report = createReport({
    command: process.argv,
    at: new Date().toISOString(),
    browser: args.browser,
    browserVersion: browser.version(),
    playwright: playwrightVersion,
    mathjax: await page.evaluate('FormulaClock.diagnostics().mathjax'),
    cases: cases,
    errors: errors,
    requests: requests,
  });
  await ctx.close();
  await browser.close();
  assert.ok(!(errors.length > 0), inspect(errors));
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
  console.log(
    JSON.stringify(
      {
        browser: args.browser,
        version: report['browserVersion'],
        mathjax: report['mathjax'],
        cases: cases.length,
        errors: errors,
      },
      null,
      2,
    ),
  );
});
