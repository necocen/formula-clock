import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import type { Expr, DisplayOptions } from '../../src/shared/types.ts';
import { test, createReport, playwrightVersion, zip, sorted } from '../helpers/browser.ts';

declare global {
  var originalSourceDigits: SVGGElement[];
  var originalSourceColons: SVGGElement[];
  var beforeStyle: string | null;
  var sourceChildren: (ChildNode | null)[];
  var colonChildren: (ChildNode | null)[];
  var customAst: Expr;
  var late: (() => void)[];
  var prefetchReads: string[];
}

test.use({
  locale: 'ja-JP',
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Asia/Tokyo',
});
test('clock', async ({ browser, args, context: ctx }) => {
  // Either optional motion feature includes the basic-symbol prerequisite.
  args.symbolMotion = args.symbolMotion || args.structureMotion || args.symbolMorph;
  const out = args.outputDir;
  const report = createReport({
    url: args.url,
    browser: args.browser,
    playwright: playwrightVersion,
    node: process.version,
    command: process.argv,
    at: new Date().toISOString(),
    cases: [],
    checks: [],
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  const requests: string[] = [];
  report['browserVersion'] = browser.version();
  const saved = JSON.stringify({
    symbolMotion: args.symbolMotion,
    structureMotion: args.structureMotion,
    symbolMorph: args.symbolMorph,
  });
  await ctx.addInitScript((s) => localStorage.setItem('formula-clock-display-v2', s), saved);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => (msg.type() === 'warning' ? warnings.push(msg.text()) : null));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.FormulaClock?.state.engineReady && FormulaClock.state.layout,
    undefined,
    { timeout: 35000 },
  );
  await page.evaluate(() => {
    window.originalDigits = FormulaClock.digits;
  });
  await page.evaluate(() => {
    window.originalSourceDigits = [
      ...document.querySelectorAll<SVGGElement>('#source-time .source-digit'),
    ];
    window.originalSourceColons = [
      ...document.querySelectorAll<SVGGElement>('#source-time .colon'),
    ];
  });
  await page.evaluate(() => {
    window.originalProvider = FORMULA_CLOCK_CONFIG.provider!;
  });
  report['mathjax'] = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
  assert.deepEqual(report['mathjax'], '4.1.3');
  assert.deepEqual(await page.evaluate(() => FormulaClock.state.display.font), 'stix2');
  assert.deepEqual(await page.evaluate(() => FormulaClock.state.display.numerals), 'oldstyle');
  assert.deepEqual(
    await page
      .locator('#numeral-choice input')
      .evaluateAll((options: HTMLInputElement[]) => options.map((x) => x.value)),
    ['lining', 'oldstyle'] as const,
  );
  assert.deepEqual(await page.locator('#symbol-motion').isChecked(), args.symbolMotion);
  assert.deepEqual(await page.locator('#structure-motion').isChecked(), args.structureMotion);
  assert.deepEqual(await page.locator('#symbol-morph').isChecked(), args.symbolMorph);
  assert.deepEqual(
    await page
      .locator('#font-choice option')
      .evaluateAll((options: HTMLOptionElement[]) => options.map((x) => x.value)),
    ['stix2', 'termes', 'fira', 'euler'] as const,
  );
  assert.deepEqual(
    await page
      .locator('#division-choice input')
      .evaluateAll((options: HTMLInputElement[]) => options.map((x) => x.value)),
    ['fraction', 'inline', 'slash'] as const,
  );
  assert.deepEqual(
    await page.locator('#import-data,#restore-data,#data-file,#data-status').count(),
    0,
  );
  assert.deepEqual(await page.locator('#advanced-settings .experimental-option').count(), 3);
  assert.deepEqual(
    await page
      .locator(
        '.intro,.source-caption,.mode,.minute-head,.demo-panel,footer,#info,#coverage,#date,#zone',
      )
      .count(),
    0,
  );
  assert.ok(await page.locator('#settings').isHidden());
  const stageBefore = await page.locator('#stage').boundingBox();
  await page.click('#settings-open');
  assert.ok(await page.locator('#settings').isVisible());
  assert.deepEqual(await page.evaluate(() => document.activeElement!.id), 'settings-close');
  await page.locator('.settings-links a').focus();
  await page.keyboard.press('Tab');
  assert.ok(
    await page.evaluate(() =>
      document.querySelector('#settings')!.contains(document.activeElement),
    ),
  );
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#settings').isHidden());
  assert.deepEqual(await page.evaluate(() => document.activeElement!.id), 'settings-open');
  await page.click('#settings-open');
  await page.click('#settings-close');
  assert.ok(await page.locator('#settings').isHidden());
  await page.click('#settings-open');
  await page.mouse.click(8, 8);
  assert.ok(await page.locator('#settings').isHidden());
  assert.deepEqual(await page.locator('#stage').boundingBox(), stageBefore);
  await page.click('#settings-open');
  await page.click('#licenses-open');
  assert.ok(await page.locator('#licenses').isVisible());
  assert.deepEqual(await page.evaluate(() => document.activeElement!.id), 'licenses-close');
  assert.deepEqual(await page.locator('#licenses').evaluate((el) => el.scrollTop), 0);
  assert.ok((await page.locator('#licenses').innerText()).includes('Latin Modern'));
  await page.locator('#licenses summary').last().focus();
  await page.keyboard.press('Tab');
  assert.deepEqual(await page.evaluate(() => document.activeElement!.id), 'licenses-close');
  await page.keyboard.press('Escape');
  assert.ok(
    (await page.locator('#licenses').isHidden()) && (await page.locator('#settings').isVisible()),
  );
  assert.deepEqual(await page.evaluate(() => document.activeElement!.id), 'licenses-open');
  await page.click('#licenses-open');
  await page.click('#licenses-close');
  await page.click('#licenses-open');
  await page.mouse.click(8, 8);
  assert.ok(await page.locator('#licenses').isHidden());
  assert.deepEqual(
    await page.locator('.settings-links a').getAttribute('href'),
    'https://github.com/necocen/formula-clock',
  );
  assert.deepEqual(await page.locator('#sound').innerText(), '');
  await page.keyboard.press('Escape');
  await page.click('#settings-open');
  await page.fill('#custom-time', '16:39:19');
  await page.click('#custom-go');
  await page.waitForFunction(
    () => FormulaClock.state.layout?.code === '1639' && FormulaClock.state.layout?.seconds === 19,
    undefined,
  );
  assert.ok(await page.locator('#settings').isHidden());
  assert.ok(await page.locator('#transport').isVisible());
  assert.deepEqual(await page.locator('#stage').boundingBox(), stageBefore);
  await page.click('#go-live');
  assert.ok(await page.locator('#transport').isHidden());
  assert.deepEqual(await page.locator('#stage').boundingBox(), stageBefore);
  report['checks'].push(
    'Minimal UI, four fonts and an independent numeral selector, dialog dismissal/focus trapping, custom preview, stable stage position',
  );
  async function preview(time: string, wait = 700) {
    await page.evaluate((t) => FormulaClock.preview('2026-09-08T' + t + '+09:00', true), time);
    const code = time.slice(0, 2) + time.slice(3, 5);
    const sec = Number(time.slice(6, 8));
    await page.waitForFunction(
      ([c, s]) =>
        FormulaClock.state.layout?.code === c &&
        FormulaClock.state.layout?.seconds === s &&
        FormulaClock.state.coverage !== undefined,
      [code, sec] as const,
    );
    if (wait) {
      await page.waitForTimeout(wait);
    }
    assert.ok(!(await page.evaluate(() => FormulaClock.state.engineError)));
  }
  async function settings(
    font: DisplayOptions['font'],
    division: DisplayOptions['division'],
    numerals: DisplayOptions['numerals'] = 'oldstyle',
  ) {
    await page.evaluate(
      ([font, division, numerals]) => FormulaClock.setDisplay({ font, division, numerals }),
      [font, division, numerals] as const,
    );
    await page.waitForFunction(
      ([f, d, n]) =>
        FormulaClock.state.layout?.display.font === f &&
        FormulaClock.state.layout?.display.division === d &&
        FormulaClock.state.layout?.display.numerals === n,
      [font, division, numerals] as const,
    );
    await page.waitForTimeout(720);
  }
  async function checkGeometry() {
    const diag = await page.evaluate(() => FormulaClock.diagnostics());
    assert.ok(diag.typography);
    assert.ok(
      diag['glyphs'].map((x) => x['inStage'] && x['visibility'] === 'visible').every(Boolean),
      inspect(diag),
    );
    assert.ok(
      await page.evaluate(() =>
        FormulaClock.digits.every((el, i) => el === window.originalDigits[i]),
      ),
    );
    const delta = await page.evaluate(() => {
      const stage = document.querySelector('#stage')!,
        sr = stage.getBoundingClientRect();
      if (FormulaClock.state.layout!.mode !== 'formula') return null;
      const paths = [...document.querySelectorAll('#equal-sign path[data-c="3D"]')];
      if (!paths.length) throw new Error('Missing persistent equality');
      const rects = paths.map((p) => p.getBoundingClientRect());
      return (
        (Math.min(...rects.map((r) => r.top)) + Math.max(...rects.map((r) => r.bottom))) / 2 -
        sr.top -
        sr.height / 2
      );
    });
    if (delta !== null) {
      assert.ok(Math.abs(delta) < 0.12, inspect([delta, diag] as const));
      assert.deepEqual(
        await page
          .locator('#equal-sign path')
          .first()
          .evaluate((el) => getComputedStyle(el).fill),
        'rgb(195, 200, 186)',
      );
    }
    const formula = await page.evaluate(() => FormulaClock.state.layout!.mode === 'formula');
    assert.deepEqual(await page.locator('#source-time').isVisible(), formula);
    assert.ok(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('#source-second')!).fontSize ===
          getComputedStyle(document.querySelector('#source-time [data-digit]')!).fontSize,
      ),
    );
    const source = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('#source-time')!,
        svg = el.querySelector('svg')!,
        inverse = svg.getScreenCTM()!.inverse();
      const digits = [...el.querySelectorAll<SVGGElement>('.source-digit')],
        colons = [...el.querySelectorAll('.colon')];
      function bounds(g: Element) {
        const r = g.getBoundingClientRect(),
          p = new DOMPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2).matrixTransform(inverse);
        return {
          x: p.x,
          y: p.y,
          inside:
            r.left >= el.getBoundingClientRect().left &&
            r.right <= el.getBoundingClientRect().right &&
            r.top >= el.getBoundingClientRect().top &&
            r.bottom <= el.getBoundingClientRect().bottom,
        };
      }
      return {
        font: el.dataset.font,
        numerals: el.dataset.numerals,
        text: digits.map((g) => g.dataset.value).join(''),
        persistent:
          digits.every((g, i) => g === originalSourceDigits[i]) &&
          colons.every((g, i) => g === originalSourceColons[i]),
        digits: digits.map(bounds),
        colons: colons.map(bounds),
        glyphFonts: digits.map((g) => g.querySelector('path')!.getAttribute('data-glyph-key')!),
      };
    });
    const state = await page.evaluate(() => FormulaClock.state.layout!);
    assert.ok(source['font'] === state['display']['font'] && source['persistent'], inspect(source));
    assert.deepEqual(source['numerals'], state['display']['numerals'], inspect(source));
    assert.deepEqual(
      source['text'],
      state['code'] + `${String(state['seconds']).padStart(2, '0')}`,
      inspect(source),
    );
    assert.ok(
      source['digits']
        .concat(source['colons'])
        .map((g) => g['inside'])
        .every(Boolean),
      inspect(source),
    );
    assert.ok(
      zip(source['digits'], [400, 900, 1850, 2350, 3300, 3800])
        .map(([g, x]) => Math.abs(g['x'] - x) < 1)
        .every(Boolean),
      inspect(source),
    );
    assert.ok(
      zip(source['colons'], [1375, 2825])
        .map(([g, x]) => Math.abs(g['x'] - x) < 1 && Math.abs(g['y'] - 550) < 1)
        .every(Boolean),
      inspect(source),
    );
    assert.ok(
      source['glyphFonts'].map((key) => key.startsWith(source['font'] + '@4.1.3:')).every(Boolean),
      inspect(source),
    );
    assert.ok(
      source['glyphFonts']
        .map((key) => key.includes('-tex-oldstyle:') === (source['numerals'] === 'oldstyle'))
        .every(Boolean),
      inspect(source),
    );
    assert.ok(
      await page.evaluate(() =>
        [...document.querySelectorAll('#source-time .source-digit')].every((g, i, all) => {
          const lower =
            i < 4
              ? FormulaClock.digits[i]
              : document.querySelector('.answer-digit[data-second="' + (i - 4) + '"]')!;
          const paths = (el: Element) =>
            JSON.stringify([...el.querySelectorAll('path')].map((p) => p.getAttribute('d')));
          return (
            paths(g) === paths(lower) &&
            (!i || all[i - 1].getBoundingClientRect().right < g.getBoundingClientRect().left)
          );
        }),
      ),
    );
    assert.deepEqual(await page.locator('#notation-root path[data-c="3D"]').count(), 0);
    return {
      time: diag['time'],
      display: diag['display'],
      axisErrorPx: delta,
      fontAxis: diag['typography']['axisEm'],
    };
  }
  const numeralShapes: Record<string, unknown> = {};
  for (const font of ['stix2', 'termes', 'fira', 'euler'] as const) {
    for (const numerals of ['lining', 'oldstyle'] as const) {
      for (const division of ['fraction', 'inline', 'slash'] as const) {
        await settings(font, division, numerals);
        for (const time of [
          '12:34:08',
          '12:34:16',
          '12:34:17',
          '12:34:30',
          '12:34:31',
          '12:34:59',
          '23:59:10',
          '08:59:05',
          '00:00:08',
        ]) {
          await preview(time);
          report['cases'].push(await checkGeometry());
          if (time === '12:34:08') {
            numeralShapes[([font, numerals] as const).join(':')] = await page
              .locator('#source-time [data-digit="2"] path')
              .first()
              .getAttribute('d');
          }
        }
        const diag = await page.evaluate(() => FormulaClock.diagnostics());
        assert.ok(diag.typography);
        assert.deepEqual(diag['typography']['numerals'], numerals);
        if (numerals === 'oldstyle') {
          assert.deepEqual(diag['typography']['axisMode'], 'font');
          assert.deepEqual(diag['typography']['axisEm'], diag['typography']['originalAxisEm']);
        } else {
          assert.deepEqual(diag['typography']['axisMode'], 'numeric');
          assert.deepEqual(diag['typography']['axisEm'], diag['typography']['numericAxisEm']);
        }
      }
      if (args.screenshots) {
        await preview('16:39:19');
        await page.screenshot({
          path: String(path.join(out, `${font}-${numerals}.png`)),
          fullPage: true,
        });
      }
    }
    assert.notDeepEqual(
      numeralShapes[([font, 'lining'] as const).join(':')],
      numeralShapes[([font, 'oldstyle'] as const).join(':')],
      inspect(font),
    );
  }
  assert.deepEqual(new Set(Object.values(numeralShapes)).size, 8);
  report['checks'].push(
    '216 formula/time layouts; 4 fonts × 2 numeral styles × 3 division modes; distinct native glyphs; persistent HHMM elements; lining numeric axis and oldstyle native axis',
  );
  report['checks'].push(
    'Small clock uses the selected math font with six persistent fixed-width digit cells, fixed colon centers, equal-size seconds and no clipped ascenders/descenders',
  );
  // The two controls are independent; same-family style changes replace glyph
  // children, while retaining the six slots and the currently previewed formula.
  await settings('stix2', 'fraction', 'lining');
  await preview('12:34:08');
  await page.click('#settings-open');
  await page.selectOption('#font-choice', 'fira');
  await page.waitForFunction(() => FormulaClock.state.layout!.display.font === 'fira', undefined);
  assert.deepEqual(await page.evaluate(() => FormulaClock.state.display.numerals), 'lining');
  await page.evaluate(() => {
    window.beforeStyle = [...document.querySelectorAll('#source-time .source-digit')][2]
      .querySelector('path')!
      .getAttribute('d');
  });
  await page.locator('#numeral-choice input[value=oldstyle]').check();
  await page.waitForFunction(
    () => FormulaClock.state.layout!.display.numerals === 'oldstyle',
    undefined,
  );
  await page.waitForTimeout(750);
  assert.notDeepEqual(
    await page.locator('#source-time [data-digit="2"] path').first().getAttribute('d'),
    await page.evaluate(() => beforeStyle),
  );
  assert.deepEqual(await page.evaluate(() => FormulaClock.state.layout!.code), '1234');
  assert.deepEqual(await page.evaluate(() => FormulaClock.state.layout!.seconds), 8);
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('formula-clock-display-v2')!) as DisplayOptions,
  );
  assert.ok(stored['font'] === 'fira' && stored['numerals'] === 'oldstyle');
  await page.keyboard.press('Escape');
  // Rapid switches can complete out of order. Both the main and small clock
  // must settle to the last font AND numeral style.
  await page.evaluate(() =>
    Promise.all([
      FormulaClock.setDisplay({ font: 'euler', numerals: 'lining' }),
      FormulaClock.setDisplay({ font: 'termes', numerals: 'oldstyle' }),
      FormulaClock.setDisplay({ font: 'fira', numerals: 'lining' }),
      FormulaClock.setDisplay({ font: 'stix2', numerals: 'oldstyle' }),
    ]),
  );
  await page.waitForFunction(
    () =>
      FormulaClock.state.layout!.display.font === 'stix2' &&
      FormulaClock.state.layout!.display.numerals === 'oldstyle',
    undefined,
  );
  await page.waitForTimeout(750);
  await checkGeometry();
  report['checks'].push(
    'Independent font/numeral UI controls preserve the chosen style, expression and time; style changes update both clocks; rapid switches discard stale results',
  );
  // Reusing unchanged small-clock digits must preserve their glyph children too.
  await settings('stix2', 'fraction');
  await preview('12:34:30');
  await page.evaluate(() => {
    window.sourceChildren = originalSourceDigits.map((g) => g.firstChild);
    window.colonChildren = originalSourceColons.map((g) => g.firstChild);
  });
  await preview('12:34:31');
  assert.ok(
    await page.evaluate(
      () =>
        originalSourceDigits.slice(0, 5).every((g, i) => g.firstChild === sourceChildren[i]) &&
        originalSourceColons.every((g, i) => g.firstChild === colonChildren[i]),
    ),
  );
  assert.ok(await page.evaluate(() => originalSourceDigits[5].firstChild !== sourceChildren[5]));
  assert.ok(
    await page.evaluate(() =>
      originalSourceDigits.every((g, i) => {
        const lower =
          i < 4
            ? FormulaClock.digits[i]
            : document.querySelector('.answer-digit[data-second="' + (i - 4) + '"]')!;
        return (
          JSON.stringify([...g.querySelectorAll('path')].map((p) => p.getAttribute('d'))) ===
          JSON.stringify([...lower.querySelectorAll('path')].map((p) => p.getAttribute('d')))
        );
      }),
    ),
  );
  report['checks'].push(
    'Small-clock glyphs match the formula glyphs; unchanged digits and colon paths survive second changes',
  );
  await settings('stix2', 'inline');
  await preview('12:34:08');
  const glyphs = await page.evaluate(() => FormulaClock.diagnostics().glyphs);
  assert.ok(glyphs[2]['height'] > glyphs[0]['height'] * 1.25);
  assert.ok(
    await page.evaluate(() => {
      const s = document.querySelector('#stage')!.getBoundingClientRect();
      const el = FormulaClock.digits[2],
        r = el.getBoundingClientRect();
      return r.bottom - s.top > FormulaClock.state.layout!.items[2].matrix[5] + 10;
    }),
  );
  report['checks'].push(
    'Oldstyle 3 descends below the baseline; 1 is shorter; native axis is preserved',
  );
  if (args.screenshots) {
    await page.screenshot({ path: String(path.join(out, 'stix2-inline.png')), fullPage: true });
  }
  // Switching changes typography, not the active expression, slots, or transport.
  const ast = await page.evaluate(() => JSON.stringify(FormulaClock.state.layout!.ast));
  for (const font of ['euler', 'termes', 'fira', 'stix2'] as const) {
    for (const numerals of ['lining', 'oldstyle'] as const) {
      await settings(font, 'fraction', numerals);
      assert.deepEqual(
        await page.evaluate(() => JSON.stringify(FormulaClock.state.layout!.ast)),
        ast,
      );
      await checkGeometry();
    }
  }
  assert.deepEqual(await page.locator('.math-staging').count(), 8);
  report['checks'].push(
    'Cached independent font engines; repeated font switching leaves expression and digit identity intact',
  );
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width: width, height: 840 });
    for (const division of ['fraction', 'inline', 'slash'] as const) {
      await settings('stix2', division);
      for (const time of ['23:59:10', '12:34:59', '00:00:08']) {
        await preview(time);
        await checkGeometry();
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
      }
    }
    await page.click('#settings-open');
    let r = await page.locator('#settings').boundingBox();
    assert.ok(r);
    assert.ok(r['x'] >= 0 && r['x'] + r['width'] <= width + 1);
    assert.ok(r['y'] >= 0 && r['y'] + r['height'] <= 840);
    if ((await page.locator('#advanced-settings').getAttribute('open')) === null)
      await page.click('#advanced-settings summary');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (args.screenshots) {
      await page.screenshot({
        path: String(path.join(out, `settings-${width}.png`)),
        fullPage: true,
      });
    }
    await page.click('#licenses-open');
    r = await page.locator('#licenses').boundingBox();
    assert.ok(r);
    assert.ok(
      r['x'] >= 0 && r['x'] + r['width'] <= width + 1 && r['y'] >= 0 && r['y'] + r['height'] <= 840,
    );
    await page.locator('#licenses summary').first().click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (args.screenshots) {
      await page.screenshot({
        path: String(path.join(out, `licenses-${width}.png`)),
        fullPage: true,
      });
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    if (args.screenshots) {
      await page.screenshot({
        path: String(path.join(out, `stix2-mobile-${width}.png`)),
        fullPage: true,
      });
    }
  }
  report['checks'].push(
    '320 / 390 / 768 px: no horizontal overflow; fractions, superscripts and plain time visible',
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const time of ['12:59:58', '13:00:00', '23:59:58', '00:00:00']) {
    await preview(time);
    await checkGeometry();
  }
  report['checks'].push('HTTP provider crosses hour and midnight boundaries');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await preview('23:59:10');
  await checkGeometry();
  await preview('12:34:59');
  await checkGeometry();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  report['checks'].push('Reduced-motion fractions and powers stay visible');
  // Carefully chosen valid clock equation: 1 + 2 / (4 / 8) = 5.
  const nested: Expr = {
    op: 'add',
    a: { op: 'lit', i: 0, j: 1 },
    b: {
      op: 'div',
      a: { op: 'lit', i: 1, j: 2 },
      b: { op: 'div', a: { op: 'lit', i: 2, j: 3 }, b: { op: 'lit', i: 3, j: 4 } },
    },
  };
  await preview('12:48:05');
  await page.evaluate((ast) => {
    window.customAst = ast;
    FormulaClock.setDataProvider({
      async getMinute(hhmm) {
        const seconds = Array(60).fill(null);
        if (hhmm === '1248') seconds[5] = ast;
        return { schema: 'formula-clock/1', hhmm, seconds };
      },
    });
  }, nested);
  await page.waitForFunction(
    () => FormulaClock.state.coverage === 1 && FormulaClock.state.layout?.mode === 'formula',
    undefined,
  );
  await settings('stix2', 'inline');
  await checkGeometry();
  let tex = await page.evaluate(() => FormulaClock.state.layout!.tex);
  assert.ok(
    tex.split('\\div').length - 1 === 2 && tex.split('\\left(').length - 1 === 1,
    inspect(tex),
  );
  await settings('stix2', 'slash');
  await checkGeometry();
  tex = await page.evaluate(() => FormulaClock.state.layout!.tex);
  assert.ok(tex.split('/').length - 1 === 2 && tex.split('\\left(').length - 1 === 1, inspect(tex));
  assert.deepEqual(await page.locator('#operator-root path[data-c="2F"]').count(), 2);
  assert.deepEqual(await page.evaluate(() => FormulaClock.state.layout!.ast), nested);
  report['checks'].push(
    'Nested obelus and slash division preserve denominator parentheses, the AST and persistent digits',
  );
  // A provider is allowed to ignore AbortSignal: revision checks still reject late data.
  await page.evaluate(() => {
    window.late = [];
    FormulaClock.setDataProvider({
      getMinute(hhmm) {
        return new Promise((resolve) =>
          late.push(() =>
            resolve({ schema: 'formula-clock/1', hhmm, seconds: Array(60).fill(null) }),
          ),
        );
      },
    });
  });
  await page.waitForFunction(() => late.length >= 1, undefined);
  await page.evaluate(() =>
    FormulaClock.setDataProvider({
      async getMinute(hhmm) {
        const seconds = Array(60).fill(null);
        if (hhmm === '1248') seconds[5] = customAst;
        return { schema: 'formula-clock/1', hhmm, seconds };
      },
    }),
  );
  await page.waitForFunction(
    () => FormulaClock.state.coverage === 1 && FormulaClock.state.layout?.mode === 'formula',
    undefined,
  );
  await page.evaluate(() => late.forEach((resolve) => resolve()));
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => FormulaClock.state.coverage), 1);
  await page.evaluate(() =>
    FormulaClock.setDataProvider({
      async getMinute() {
        throw new Error('Test transport failure');
      },
    }),
  );
  await page.waitForFunction(
    () => FormulaClock.state.dataError && FormulaClock.state.layout?.mode === 'time',
    undefined,
  );
  await page.waitForTimeout(700);
  await checkGeometry();
  assert.ok((await page.locator('#state-label').innerText()).includes('読み込めなかった'));
  report['checks'].push(
    'Late old-provider response discarded; failed data delivery is distinct from null and displays ordinary time',
  );
  await page.evaluate(() => FormulaClock.setDataProvider(originalProvider));
  await preview('12:34:30');
  await settings('stix2', 'inline');
  // The equal sign retains its group AND paths while moving between formulas.
  const equality = await page.evaluate(async () => {
    const el = document.querySelector('#equal-sign')!,
      child = el.firstChild,
      samples = [];
    FormulaClock.preview('2026-09-08T12:34:31+09:00');
    const started = performance.now();
    while (performance.now() - started < 850) {
      await new Promise(requestAnimationFrame);
      const r = el.getBoundingClientRect(),
        stage = document.querySelector('#stage')!.getBoundingClientRect();
      samples.push({
        x: r.x,
        axis: (r.top + r.bottom) / 2 - stage.top - stage.height / 2,
        opacity: getComputedStyle(el).opacity,
        same: el.firstChild === child,
      });
    }
    return samples;
  });
  assert.ok(
    equality
      .map((s) => s['same'] && s['opacity'] === '1' && Math.abs(s['axis']) < 0.12)
      .every(Boolean),
    inspect(equality),
  );
  const xs = equality.map((s) => s['x']);
  assert.ok(
    Math.max(...xs) - Math.min(...xs) > 1 && new Set(xs.map((x) => Number(x.toFixed(2)))).size > 5,
    inspect(xs),
  );
  report['checks'].push(
    'Persistent equal-sign glyph moves continuously on the fixed axis; source time only appears above formulas with equal-size seconds',
  );
  await preview('12:34:30');
  // Sample the actual animated transforms at 30 -> 31 (all HHMM stay on baseline).
  const samples = await page.evaluate(async () => {
    const out = [];
    FormulaClock.preview('2026-09-08T12:34:31+09:00');
    const started = performance.now();
    while (performance.now() - started < 850) {
      await new Promise(requestAnimationFrame);
      out.push(FormulaClock.digits.map((x) => x.transform.baseVal.consolidate()!.matrix.f));
    }
    return out;
  });
  const ranges = Array.from({ length: 4 }, (_, i) => i).map(
    (i) => Math.max(...samples.map((x) => x[i])) - Math.min(...samples.map((x) => x[i])),
  );
  assert.ok(Math.max(...ranges) < 0.01, inspect(ranges));
  report['animationSamples'] = samples.length;
  report['baselineRangesPx'] = ranges;
  await settings('stix2', 'fraction');
  await preview('16:39:19');
  if (args.screenshots) {
    await page.screenshot({ path: String(path.join(out, 'stix2-163919.png')), fullPage: true });
  }
  await page.evaluate(() => FormulaClock.live());
  await page.waitForTimeout(1000);
  if (args.screenshots) {
    await page.screenshot({ path: String(path.join(out, 'live.png')), fullPage: true });
  }
  if (await page.locator('#fullscreen').isVisible()) {
    await preview('12:34:30');
    const normalSize = await page.evaluate(() => FormulaClock.state.layout!.fontSize);
    await page.click('#fullscreen');
    await page.waitForFunction(
      () => document.fullscreenElement || document.webkitFullscreenElement,
      undefined,
    );
    assert.deepEqual(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(
      (size) => FormulaClock.state.layout!.fontSize > size * 1.4,
      normalSize,
    );
    assert.ok((await page.evaluate(() => FormulaClock.state.layout!.fontSize)) <= 160.01);
    assert.ok(
      await page.evaluate(() => FormulaClock.digits.every((el, i) => el === originalDigits[i])),
    );
    await page.click('#fullscreen');
    await page.waitForFunction(
      () => !document.fullscreenElement && !document.webkitFullscreenElement,
      undefined,
    );
    assert.deepEqual(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'false');
    await page.waitForFunction(
      (size) => Math.abs(FormulaClock.state.layout!.fontSize - size) < 0.01,
      normalSize,
    );
    report['checks'].push(
      'Native fullscreen enlarges the clock within 160px, preserves digit elements and restores the normal size on exit',
    );
  } else {
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('fullscreen'))));
    report['checks'].push('Unsupported fullscreen control is hidden');
  }
  await page.click('#sound');
  await page.evaluate(() => FormulaClock.preview('2026-09-08T23:59:56.700+09:00', false));
  await page.waitForTimeout(4750);
  const audio = await page.evaluate(() => FormulaClock.state.audio);
  const midnight = audio.filter((x) => ['countdown', 'minute'].includes(x['type'])).map((x) => x);
  assert.deepEqual(
    midnight.slice(-4).map((x) => x['frequency']),
    [500, 500, 500, 1000],
    inspect(audio),
  );
  report['checks'].push(
    '117-style midnight audio: three 500 Hz countdown pulses followed by the 1000 Hz minute signal',
  );
  // Fix wall time while leaving rendering timers running. Observe the public
  // provider contract so the same scheduling checks apply to either delivery mode.
  await page.click('#sound');
  async function liveAt(time: string) {
    await page.clock.setFixedTime('2026-09-09T' + time + '+09:00');
    await page.evaluate(() => FormulaClock.live());
  }
  async function trackPrefetch() {
    await page.evaluate(() => {
      Math.random = () => 0.5;
      window.prefetchReads = [];
      FormulaClock.setDataProvider({
        async getMinute(hhmm) {
          prefetchReads.push(hhmm);
          return { schema: 'formula-clock/1', hhmm, seconds: Array(60).fill(null) };
        },
      });
    });
    await page.waitForFunction(() => FormulaClock.state.coverage === 0, undefined);
  }
  await liveAt('12:59:00');
  await trackPrefetch();
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['1259']);
  // A redraw must not draw a new deadline.
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await liveAt('12:59:14');
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['1259']);
  await liveAt('12:59:15');
  await page.waitForFunction(() => prefetchReads.includes('1300'), undefined);
  await liveAt('12:59:29');
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['1259', '1300']);
  await liveAt('23:59:00');
  await trackPrefetch();
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['2359']);
  await liveAt('23:59:15');
  await page.waitForFunction(() => prefetchReads.includes('0000'), undefined);
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['2359', '0000']);
  await liveAt('12:59:00');
  await trackPrefetch();
  await page.evaluate(() => FormulaClock.preview('2026-09-09T12:59:00+09:00'));
  await page.waitForFunction(() => prefetchReads.includes('1300'), undefined);
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['1259', '1300']);
  await liveAt('13:59:50');
  await trackPrefetch();
  await page.waitForFunction(() => prefetchReads.includes('1400'), undefined);
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['1359', '1400']);
  await liveAt('12:59:00');
  await trackPrefetch();
  // Resume after skipping the pending hour boundary.
  await liveAt('14:00:00');
  await page.waitForFunction(() => prefetchReads.includes('1401'), undefined);
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['1259', '1400', '1401']);
  // Replacing the provider must discard the earlier plan.
  await trackPrefetch();
  await liveAt('14:00:30');
  assert.deepEqual(await page.evaluate(() => prefetchReads), ['1400', '1401']);
  report['checks'].push(
    'Live hour prefetch is jittered once within :59:00–30; midnight, immediate current/preview/late-entry requests and skipped-minute/provider cleanup',
  );
  const migrations = [
    [{ font: 'stix2' }, 'stix2', 'oldstyle'] as const,
    [{ font: 'euler' }, 'euler', 'lining'] as const,
    [{ font: 'oldstyle' }, 'stix2', 'oldstyle'] as const,
    [{ font: 'termes', numerals: 'lining' }, 'termes', 'lining'] as const,
    [{ font: 'euler', numerals: 'oldstyle' }, 'euler', 'oldstyle'] as const,
  ];
  for (const [saved, font, numerals] of migrations) {
    const migrationCtx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const migration = await migrationCtx.newPage();
    // A session flag applies the input once, allowing reload to read the
    // settings written by the real controls/API on the previous page load.
    await migration.addInitScript((s) => {
      if (!sessionStorage.fontMigration) {
        localStorage.setItem('formula-clock-display-v2', s);
        sessionStorage.fontMigration = '1';
      }
    }, JSON.stringify(saved));
    await migration.goto(args.url);
    await migration.waitForFunction(
      () => window.FormulaClock?.state.engineReady && FormulaClock.state.layout,
      undefined,
    );
    assert.deepEqual(await migration.evaluate(() => FormulaClock.state.display.font), font);
    assert.deepEqual(await migration.evaluate(() => FormulaClock.state.display.numerals), numerals);
    assert.deepEqual(await migration.locator('#font-choice').inputValue(), font);
    assert.deepEqual(
      await migration.locator('#numeral-choice input:checked').inputValue(),
      numerals,
    );
    await migration.evaluate(() => FormulaClock.setDisplay({ font: 'fira', numerals: 'lining' }));
    await migration.reload();
    await migration.waitForFunction(
      () => window.FormulaClock?.state.engineReady && FormulaClock.state.layout,
      undefined,
    );
    assert.deepEqual(await migration.evaluate(() => FormulaClock.state.display.font), 'fira');
    assert.deepEqual(await migration.evaluate(() => FormulaClock.state.display.numerals), 'lining');
    await migrationCtx.close();
  }
  report['checks'].push(
    'Old STIX/Euler/Computer Modern settings migrate without changing their appearance; independent font/numeral selections survive reload',
  );
  assert.ok(!(errors.length > 0), inspect(errors));
  report['pageErrors'] = errors;
  report['warnings'] = warnings;
  report['dataRequests'] = sorted(
    new Set(requests.filter((url) => url.includes('/data/')).map((url) => url)),
  );
  const name = 'browser-results.json';
  fs.writeFileSync(
    path.join(out, name),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
