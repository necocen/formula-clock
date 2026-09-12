import { literal as L, binary as B, unary as U } from '../fixtures/ast.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, inspect } from 'node:util';
import type { Expr, DisplayOptions, FormulaProvider } from '../../src/shared/types.ts';
import type { Frame } from '../../src/browser/types.ts';
import {
  test,
  createReport,
  playwrightVersion,
  zip,
  sorted,
  factorial,
} from '../helpers/browser.ts';
declare global {
  var fixtures: (readonly [string, string, number, Expr])[];
  var originalEqual: Element | null;
  var fixtureProvider: FormulaProvider;
  var oldRoot: SVGGElement[] | SVGGElement;
  var oldRootKey: string | undefined;
  var oldParens: SVGGElement[];
  var oldParenKeys: (string | undefined)[];
}
interface StructureSample {
  state: {
    kind: string;
    same: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: string;
  }[];
  junction: number[] | null;
}
test.use({
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Asia/Tokyo',
});
test('structure-motion', async ({ browser, args, page }) => {
  const fixtures: (readonly [string, string, number, Expr])[] = [
    ['fraction-narrow', '1212', 1, B('div', L(0, 2), L(2, 4))] as const,
    [
      'fraction-wide',
      '1212',
      2,
      B('div', U('fact', B('add', L(0), L(1))), B('add', L(2), L(3))),
    ] as const,
    ['root-narrow', '1444', 16, B('add', U('sqrt', L(0, 3)), L(3))] as const,
    [
      'root-wide',
      '1444',
      7,
      B('add', U('sqrt', B('add', B('add', L(0), L(1)), L(2))), L(3)),
    ] as const,
    [
      'root-wide-mul',
      '1444',
      8,
      B('add', U('sqrt', B('mul', B('mul', L(0), L(1)), L(2))), L(3)),
    ] as const,
    [
      'root-tall',
      '1444',
      5,
      B('add', U('sqrt', B('mul', B('div', L(0), L(1)), L(2))), L(3)),
    ] as const,
    ['paren-wide', '1444', 36, B('mul', B('add', B('add', L(0), L(1)), L(2)), L(3))] as const,
    ['paren-narrow', '1444', 32, B('mul', B('add', B('mul', L(0), L(1)), L(2)), L(3))] as const,
    ['paren-tall', '1444', 17, B('mul', B('add', B('div', L(0), L(1)), L(2)), L(3))] as const,
    [
      'root-attachment',
      '1444',
      9,
      B('add', L(0), B('mul', U('sqrt', L(1)), U('sqrt', B('mul', L(2), L(3))))),
    ] as const,
  ];
  let deep: Expr = B('mul', L(0), B('mul', L(1), B('mul', L(2), L(3))));
  for (const _iteration of Array.from({ length: 18 }, (_, i) => i)) {
    deep = U('sqrt', deep);
  }
  fixtures.push(['assembled-root', '1111', 1, deep] as const);
  let deepBase: Expr = B('mul', L(0), B('mul', L(1), L(2)));
  for (const _iteration of Array.from({ length: 18 }, (_, i) => i)) {
    deepBase = U('sqrt', deepBase);
  }
  fixtures.push(['assembled-paren', '1112', 1, B('pow', deepBase, L(3))] as const);
  function value(ast: Expr, code: string): number {
    if (ast.op === 'lit') return Number(code.slice(ast.i, ast.j));
    const x = value(ast.a, code);
    switch (ast.op) {
      case 'sqrt':
        return Math.sqrt(x);
      case 'fact':
        return factorial(x);
      case 'neg':
        return -x;
      case 'add':
        return x + value(ast.b, code);
      case 'sub':
        return x - value(ast.b, code);
      case 'mul':
        return x * value(ast.b, code);
      case 'div':
        return x / value(ast.b, code);
      case 'pow':
        return x ** value(ast.b, code);
    }
  }
  // These are real equations. The browser remains responsible only for presentation.
  for (const [name, code, seconds, ast] of fixtures) {
    assert.deepEqual(
      value(ast, code),
      seconds,
      inspect([name, value(ast, code), seconds] as const),
    );
  }
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    url: args.url,
    node: process.version,
    playwright: playwrightVersion,
    fonts: ['stix2', 'termes', 'fira', 'euler'] as const,
    numerals: ['lining', 'oldstyle'] as const,
    checks: [],
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  report['browserVersion'] = browser.version();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => (msg.type() === 'warning' ? warnings.push(msg.text()) : null));
  await page.goto(args.url);
  await page.waitForFunction(
    () => window.FormulaClock?.state.engineReady && FormulaClock.state.layout,
    undefined,
  );
  assert.ok(await page.evaluate(() => FormulaClock.state.display.structureMotion));
  await page.evaluate(() =>
    FormulaClock.setDisplay({ symbolMotion: false, structureMotion: false, symbolMorph: false }),
  );
  await page.evaluate(() => {
    window.originalProvider = FORMULA_CLOCK_CONFIG.provider!;
  });
  report['mathjax'] = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
  assert.deepEqual(report['mathjax'], '4.1.3');
  await page.evaluate((fixtures: (readonly [string, string, number, Expr])[]) => {
    window.fixtures = fixtures;
    window.originalDigits = FormulaClock.digits;
    window.originalEqual = document.querySelector('#equal-sign');
    const minutes: Record<string, (Expr | null)[]> = {};
    for (const [, code, seconds, ast] of fixtures) {
      FormulaExpression.validateAst(ast, code);
      (minutes[code] ||= Array(60).fill(null))[seconds] = ast;
    }
    window.fixtureProvider = {
      async getMinute(hhmm) {
        return { schema: 'formula-clock/1', hhmm, seconds: minutes[hhmm] || Array(60).fill(null) };
      },
    };
    FormulaClock.setDataProvider(fixtureProvider);
  }, fixtures);
  // Compare every visible path/rectangle after reconstructing the actual frame.
  // This catches displaced bars, duplicate extraction and missing delimiter pieces.
  report['geometry'] = await page.evaluate(async () => {
    const out = [],
      NS = 'http://www.w3.org/2000/svg';
    function geometry(frame: Frame) {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '20000');
      svg.setAttribute('height', '20000');
      svg.style.cssText = 'position:fixed;left:-100000px;top:0';
      svg.append(frame.decorations.cloneNode(true));
      for (const token of [
        ...frame.tokens,
        ...(frame.equality ? [frame.equality] : []),
        ...frame.symbols,
      ]) {
        const group = token.shape.cloneNode(true) as SVGGElement;
        group.setAttribute('transform', `matrix(${token.matrix.join(' ')})`);
        svg.append(group);
      }
      document.body.append(svg);
      try {
        return [...svg.querySelectorAll<SVGPathElement | SVGRectElement>('path,rect')]
          .map((el) => {
            const m = svg.getScreenCTM()!.inverse().multiply(el.getScreenCTM()!),
              b = el.getBBox();
            const points = [
              [b.x, b.y],
              [b.x + b.width, b.y],
              [b.x, b.y + b.height],
              [b.x + b.width, b.y + b.height],
            ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
            return {
              key: el.localName === 'path' ? el.getAttribute('d')! : 'rule',
              box: [
                Math.min(...points.map((p) => p.x)),
                Math.min(...points.map((p) => p.y)),
                Math.max(...points.map((p) => p.x)),
                Math.max(...points.map((p) => p.y)),
              ],
            };
          })
          .sort((a, b) => a.key.localeCompare(b.key) || a.box[0] - b.box[0] || a.box[1] - b.box[1]);
      } finally {
        svg.remove();
      }
    }
    for (const font of ['stix2', 'termes', 'fira', 'euler'] as const)
      for (const numerals of ['lining', 'oldstyle'] as const) {
        const engine = new FormulaTypesetter.Typesetter(font, numerals);
        await engine.boot;
        for (const division of ['fraction', 'inline'] as const)
          for (const [name, code, seconds, ast] of window.fixtures) {
            const baseline = await engine.frame(ast, code, seconds, { division });
            const expected = geometry(baseline);
            for (const symbolMotion of [false, true])
              for (const structureMotion of [false, true]) {
                const frame = await engine.frame(ast, code, seconds, {
                  division,
                  symbolMotion,
                  structureMotion,
                });
                const actual = geometry(frame);
                if (
                  JSON.stringify(expected.map((p) => p.key)) !==
                  JSON.stringify(actual.map((p) => p.key))
                )
                  throw Error('Glyph count/content changed: ' + font + name);
                const delta = Math.max(
                  ...expected.flatMap((p, i) =>
                    p.box.map((x, j) => Math.abs(x - actual[i].box[j])),
                  ),
                );
                // Firefox's SVGMatrix rounds off-screen coordinates to float32.
                // One font unit is at most 0.112px at the app's maximum display scale.
                if (delta > 1)
                  throw Error(
                    'Geometry changed: ' +
                      JSON.stringify({
                        font,
                        name,
                        division,
                        symbolMotion,
                        structureMotion,
                        delta,
                        differences: expected
                          .map((p, i) => ({
                            key: p.key.slice(0, 40),
                            before: p.box,
                            after: actual[i].box,
                          }))
                          .filter((p) => p.before.some((x, j) => Math.abs(x - p.after[j]) > 1)),
                        digitDelta: Math.max(
                          ...baseline.tokens.flatMap((t, i) =>
                            t.matrix.map((x, j) => Math.abs(x - frame.tokens[i].matrix[j])),
                          ),
                        ),
                      }),
                  );
                if (JSON.stringify(baseline.viewBox) !== JSON.stringify(frame.viewBox))
                  throw Error('ViewBox changed');
                out.push({ font, numerals, name, division, symbolMotion, structureMotion, delta });
              }
          }
        engine['staging'].remove();
      }
    return out;
  });
  report['checks'].push(
    'All glyph/rule bounds and viewBox match in all four fonts and both numeral styles, division styles and all four experiment combinations',
  );
  async function display(opts: Partial<DisplayOptions>) {
    await page.evaluate((opts: Partial<DisplayOptions>) => FormulaClock.setDisplay(opts), opts);
    await page.waitForFunction(
      (opts: Partial<DisplayOptions>) =>
        Object.entries(opts).every(
          ([k, v]) => FormulaClock.state.layout!.display[k as keyof DisplayOptions] === v,
        ),
      opts,
    );
    await page.waitForTimeout(740);
  }
  async function preview(name: string, wait = 740) {
    const fixture =
      name !== 'null'
        ? fixtures.filter((x) => x[0] === name).map((x) => x)[0]!
        : (['null', '0000', 8, null] as const);
    const [, code, seconds] = fixture;
    await page.evaluate(
      ([code, s]: readonly [string, number]) =>
        FormulaClock.preview(
          `2026-09-08T${code.slice(0, 2)}:${code.slice(2)}:${String(s).padStart(2, '0')}+09:00`,
        ),
      [code, seconds] as const,
    );
    await page.waitForFunction(
      ([c, s]: readonly [string, number]) =>
        FormulaClock.state.layout!.code === c &&
        FormulaClock.state.layout!.seconds === s &&
        !FormulaClock.state.engineError,
      [code, seconds] as const,
    );
    if (wait) {
      await page.waitForTimeout(wait);
    }
  }
  async function sampleTransition(target: string, kinds: string[]): Promise<StructureSample[]> {
    const fixture = fixtures.filter((x) => x[0] === target).map((x) => x)[0]!;
    return await page.evaluate(
      async ([code, seconds, kinds]: readonly [string, number, string[]]) => {
        const find = (kind: string) =>
          document.querySelector<SVGGElement>(`#operator-root [data-kind="${kind}"]`);
        const old = kinds.map((kind) => {
          const el = find(kind);
          if (!el) throw Error('Missing ' + kind);
          return { kind, el, shape: el.firstChild };
        });
        function capture() {
          const state = old.map(({ el, shape, kind }) => {
            const r = el.getBoundingClientRect();
            return {
              kind,
              same: el.isConnected && el.firstChild === shape,
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              opacity: getComputedStyle(el).opacity,
            };
          });
          const sign = find('root-sign'),
            rule = find('root-rule');
          let junction = null;
          if (sign && rule) {
            const m = rule.getScreenCTM()!,
              inv = sign.getScreenCTM()!.inverse(),
              p = new DOMPoint(m.e, m.f).matrixTransform(inv);
            junction = [p.x, p.y];
          }
          return { state, junction };
        }
        const samples = [capture()];
        FormulaClock.preview(
          `2026-09-08T${code.slice(0, 2)}:${code.slice(2)}:${String(seconds).padStart(2, '0')}+09:00`,
        );
        const start = performance.now();
        while (performance.now() - start < 850) {
          await new Promise(requestAnimationFrame);
          samples.push(capture());
        }
        return samples;
      },
      [fixture[1], fixture[2], kinds] as const,
    );
  }
  const motion: { font: string; numerals: string; maxRootJunctionDriftEm: number }[] = [];
  report['motion'] = motion;
  for (const [font, numerals] of (['stix2', 'termes', 'fira', 'euler'] as const).flatMap((f) =>
    (['lining', 'oldstyle'] as const).map((n) => [f, n] as const),
  )) {
    await display({
      font: font,
      numerals: numerals,
      division: 'fraction',
      symbolMotion: true,
      structureMotion: true,
    });
    await preview('fraction-narrow');
    let samples = await sampleTransition('fraction-wide', ['fraction-rule']);
    assert.ok(
      samples.map((s) => s['state'][0]['same'] && s['state'][0]['opacity'] === '1').every(Boolean),
    );
    assert.ok(new Set(samples.map((s) => Number(s['state'][0]['width'].toFixed(2)))).size > 8);
    // Width interpolation must not stretch the bar's stroke along with its length.
    const start = samples[0]['state'][0];
    const end = samples.at(-1)!['state'][0];
    for (const s of samples) {
      const row = s['state'][0];
      const progress = (row['width'] - start['width']) / (end['width'] - start['width']);
      assert.ok(
        Math.abs(row['height'] - (start['height'] + (end['height'] - start['height']) * progress)) <
          0.12,
      );
    }
    // Euler oldstyle's native + selects a larger radical than its low
    // digits. Multiplication keeps the same size while widening the rule.
    const wideRoot = isDeepStrictEqual([font, numerals] as const, ['euler', 'oldstyle'] as const)
      ? 'root-wide-mul'
      : 'root-wide';
    await preview('root-narrow');
    samples = await sampleTransition(wideRoot, ['root-sign', 'root-rule']);
    assert.ok(
      samples
        .flatMap((s) => s['state'].map((r) => r['same'] && r['opacity'] === '1'))
        .every(Boolean),
    );
    assert.ok(new Set(samples.map((s) => Number(s['state'][1]['width'].toFixed(2)))).size > 8);
    const origin = samples[0]['junction'];
    assert.ok(origin);
    assert.ok(samples.every((sample) => sample.junction));
    const drift = Math.max(
      ...samples.flatMap((s) => zip(s['junction']!, origin).map(([x, y]) => Math.abs(x - y))),
    );
    // <0.224px at the largest 112px/em rendering scale.
    assert.ok(drift < 2, inspect([font, drift] as const));
    await page.evaluate(() => {
      window.oldRoot = [
        ...document.querySelectorAll<SVGGElement>(
          '[data-kind="root-sign"],[data-kind="root-rule"]',
        ),
      ];
      window.oldRootKey = (oldRoot as SVGGElement[])[0].dataset.glyphKey;
    });
    await preview('root-tall');
    assert.ok(
      await page.evaluate(
        () =>
          (oldRoot as SVGGElement[]).every((x) => !x.isConnected) &&
          document.querySelector<SVGGElement>('[data-kind="root-sign"]')!.dataset.glyphKey !==
            oldRootKey,
      ),
    );
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector<SVGGElement>('[data-kind="root-sign"]')!.dataset.glyphKey ===
          document.querySelector<SVGGElement>('[data-kind="root-rule"]')!.dataset.glyphKey,
      ),
    );
    await page.screenshot({
      path: String(path.join(args.outputDir, `root-${font}-${numerals}.png`)),
    });
    await preview('paren-wide');
    samples = await sampleTransition('paren-narrow', ['paren-left', 'paren-right']);
    assert.ok(
      samples
        .flatMap((s) => s['state'].map((r) => r['same'] && r['opacity'] === '1'))
        .every(Boolean),
    );
    await page.evaluate(() => {
      window.oldParens = [
        ...document.querySelectorAll<SVGGElement>(
          '[data-kind="paren-left"],[data-kind="paren-right"]',
        ),
      ];
      window.oldParenKeys = oldParens.map((x) => x.dataset.glyphKey);
    });
    await preview('paren-tall');
    assert.ok(
      await page.evaluate(
        () =>
          oldParens.every((x) => !x.isConnected) &&
          [
            ...document.querySelectorAll<SVGGElement>(
              '[data-kind="paren-left"],[data-kind="paren-right"]',
            ),
          ].every((x) => !oldParenKeys.includes(x.dataset.glyphKey)),
      ),
    );
    await preview('root-wide');
    await page.evaluate(() => {
      window.oldRoot = document.querySelector<SVGGElement>('[data-kind="root-sign"]')!;
    });
    await preview('root-attachment');
    assert.ok(await page.evaluate(() => !(oldRoot as SVGGElement).isConnected));
    await preview('assembled-root');
    // Larger radicals assembled from pieces still fade.
    assert.ok((await page.locator('#notation-root path').count()) > 0);
    assert.deepEqual(await page.evaluate(() => FormulaClock.state.layout!.mode), 'formula');
    motion.push({ font: font, numerals: numerals, maxRootJunctionDriftEm: drift / 1000 });
  }
  report['checks'].push(
    'Rules resize continuously with independent thickness; same radicals/parentheses retain DOM and glyphs; size/attachment changes replace them; assembled radicals keep fading',
  );
  // Real dataset, rapid interruptions, resize, settings persistence and reduced motion.
  await page.evaluate(() => FormulaClock.setDataProvider(originalProvider));
  for (const i of Array.from({ length: 30 }, (_, i) => i)) {
    await page.evaluate(
      (s: number) =>
        FormulaClock.preview('2026-09-08T12:34:' + String(s).padStart(2, '0') + '+09:00'),
      i,
    );
    await page.waitForFunction(
      (s: number) =>
        FormulaClock.state.layout!.code === '1234' && FormulaClock.state.layout!.seconds === s,
      i,
    );
  }
  await page.waitForTimeout(800);
  assert.ok(
    await page
      .locator('#operator-root > g')
      .evaluateAll(
        (els) =>
          new Set(els.map((x) => [x.dataset.kind, x.dataset.site, x.dataset.glyphKey].join(':')))
            .size === els.length,
      ),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(800);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.click('#settings-open');
  if ((await page.locator('#advanced-settings').getAttribute('open')) === null) {
    await page.click('#advanced-settings summary');
  }
  await page.uncheck('#structure-motion');
  await page.check('#structure-motion');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => FormulaClock.setDataProvider(fixtureProvider));
  await preview('root-wide', 80);
  assert.deepEqual(
    await page
      .locator('#operator-root')
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
    0,
  );
  await page.screenshot({ path: String(path.join(args.outputDir, 'mobile.png')) });
  await preview('null', 80);
  assert.deepEqual(await page.locator('#operator-root > g').count(), 0);
  await display({ symbolMotion: false, structureMotion: false });
  await preview('root-wide');
  assert.deepEqual(await page.locator('#operator-root > g').count(), 0);
  await display({ symbolMotion: true, structureMotion: true });
  assert.deepEqual(await page.locator('#operator-root [data-kind="root-sign"]').count(), 1);
  assert.ok(
    await page.evaluate(
      () =>
        FormulaClock.digits.every((el, i) => el === originalDigits[i]) &&
        document.querySelector('#equal-sign') === originalEqual,
    ),
  );
  await page.reload();
  await page.waitForFunction(
    () => FormulaClock.state.engineReady && FormulaClock.state.layout,
    undefined,
  );
  await page.waitForTimeout(750);
  assert.ok(
    await page.evaluate(
      () => FormulaClock.state.display.structureMotion && FormulaClock.state.display.symbolMotion,
    ),
  );
  report['checks'].push(
    'No stale symbols after rapid previews/null; mobile fits; structure motion and its prerequisite persist; reduced motion snaps; persistent digits/equality remain intact',
  );
  assert.ok(!(errors.length > 0), inspect(errors));
  report['pageErrors'] = errors;
  report['warnings'] = sorted(new Set(warnings));
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
