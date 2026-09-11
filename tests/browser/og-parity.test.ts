import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, inspect } from 'node:util';
import type { Bounds, Typography } from '../../src/shared/types.ts';
import { isRecord } from '../../src/shared/types.ts';
import Share from '../../src/shared/share.ts';
import { createServer, isRunnableDevEnvironment } from 'vite';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';
test.use({
  viewport: { width: 1200, height: 800 },
  timezoneId: 'Asia/Tokyo',
  contextOptions: { reducedMotion: 'reduce' },
});
test('og-parity', async ({ browser, args, context: ctx }) => {
  const output = args.outputDir;
  const reference = args.renderResults ?? path.join(output, 'og-reference/render-results.json');
  // Use an explicitly supplied reference as-is; otherwise render this checkout afresh.
  if (!args.renderResults) {
    // Vite loads the renderer's TypeScript and raw SVG imports in Node, just as
    // Vitest does, without teaching Playwright a separate asset loader.
    const vite = await createServer({ configFile: false, server: { middlewareMode: true } });
    try {
      const environment = vite.environments.ssr;
      assert.ok(isRunnableDevEnvironment(environment));
      const { renderOgReference } = await environment.runner.import<
        typeof import('../helpers/og-reference.ts')
      >('/tests/helpers/og-reference.ts');
      await renderOgReference(path.dirname(reference));
    } finally {
      await vite.close();
    }
  }
  const server: unknown = JSON.parse(fs.readFileSync(reference, 'utf8'));
  assert.ok(isRecord(server) && Array.isArray(server.cases));
  assert.equal(
    server.cases.length,
    240,
    'Reference must contain all four fonts and independent styles',
  );
  const cases: unknown[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
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
  assert.ok(!(errors.length > 0), inspect(errors));
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
