import assert from 'node:assert/strict';
import { test } from '../helpers/browser.ts';

declare global {
  var startupProbe: {
    painted: boolean;
    background: { kind: string; painted: boolean }[];
  };
}

test.use({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });

for (const delayed of [false, true]) {
  test(`startup prioritizes the current formula${delayed ? ' after delayed data' : ''}`, async ({
    page,
    args,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(new Date('2026-09-12T23:59:10+09:00'));
    await page.addInitScript(() => {
      Math.random = () => 0.9; // Keep the next-hour prefetch outside the frozen second.
      window.startupProbe = { painted: false, background: [] };
      let typesetter: typeof FormulaTypesetter;
      Object.defineProperty(window, 'FormulaTypesetter', {
        configurable: true,
        get: () => typesetter,
        set(value: typeof FormulaTypesetter) {
          typesetter = value;
          const prototype = value.Typesetter.prototype;
          const frame = prototype.frame;
          prototype.frame = function (ast, code, seconds, ...options) {
            if (seconds !== 10)
              startupProbe.background.push({ kind: 'next', painted: startupProbe.painted });
            return frame.call(this, ast, code, seconds, ...options);
          };
          const clockFace = prototype.clockFace;
          prototype.clockFace = function () {
            startupProbe.background.push({ kind: 'face', painted: startupProbe.painted });
            return clockFace.call(this);
          };
        },
      });
      let api: typeof FormulaClock;
      Object.defineProperty(window, 'FormulaClock', {
        configurable: true,
        get: () => api,
        set(value: typeof FormulaClock) {
          api = value;
          const observer = new MutationObserver(() => {
            if (!api.state.layout?.ast) return;
            observer.disconnect();
            requestAnimationFrame(() => {
              startupProbe.painted = true;
            });
          });
          observer.observe(document.querySelector('#stage')!, {
            attributes: true,
            childList: true,
            subtree: true,
          });
        },
      });
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (delayed)
      await page.route('**/data/hours/**', async (route) => {
        await gate;
        await route.continue();
      });
    try {
      await page.goto(args.url, { waitUntil: 'domcontentloaded' });
      if (delayed) {
        await page.waitForFunction(
          () => FormulaClock.state.engineReady && FormulaClock.state.layout,
        );
        assert.equal(
          await page.locator('#stage').evaluate((el) => el.classList.contains('loading')),
          true,
        );
        assert.deepEqual(await page.evaluate(() => startupProbe.background), []);
        release();
      }
      await page.waitForFunction(() => startupProbe.background.length >= 3);
      const probe = await page.evaluate(() => startupProbe);
      assert.ok(
        probe.background.every((entry) => entry.painted),
        JSON.stringify(probe),
      );
      assert.ok(probe.background.some((entry) => entry.kind === 'face'));
      assert.ok(probe.background.some((entry) => entry.kind === 'next'));
      await page.waitForFunction(() =>
        [...document.querySelectorAll('#source-time .source-digit')].every((el) =>
          el.querySelector('path'),
        ),
      );
      assert.deepEqual(
        await page.evaluate(() => [
          FormulaClock.state.layout?.code,
          FormulaClock.state.layout?.seconds,
          FormulaClock.state.layout?.mode,
        ]),
        ['2359', 10, 'formula'],
      );
      assert.deepEqual(errors, []);
    } finally {
      release();
    }
  });
}

test('queued frames skip stale readers, retain active readers and allow a cancelled frame to retry', async ({
  page,
  args,
}) => {
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.FormulaClock?.state.engineReady);
  const result = await page.evaluate(async () => {
    const engine = new FormulaTypesetter.Typesetter();
    await engine.boot;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.defineProperty(engine, 'boot', { value: gate });
    let active = true;
    const stale = engine.frame(null, '1234', 11, {}, () => active);
    const rejection = stale.then(
      () => 'unexpected success',
      (error: DOMException) => error.name,
    );
    const shared = engine.frame(null, '1234', 12, {}, () => active);
    const needed = engine.frame(null, '1234', 12, {}, () => true);
    active = false;
    release();
    const cancelled = await rejection;
    const current = await needed;
    const retry = await engine.frame(null, '1234', 11);
    return {
      cancelled,
      shared: shared === needed,
      cacheSize: engine.cache.size,
      current: current.tokens.map((token) => token.text).join(''),
      retry: retry.tokens.map((token) => token.text).join(''),
    };
  });
  assert.deepEqual(result, {
    cancelled: 'AbortError',
    shared: true,
    cacheSize: 2,
    current: '123412',
    retry: '123411',
  });
});

test('canonical provider ASTs reach every display style unchanged', async ({ page, args }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.FormulaClock?.state.engineReady);
  const count = await page.evaluate(async () => {
    const provider = FORMULA_CLOCK_CONFIG.provider!;
    const records = new Map<string, Awaited<ReturnType<typeof provider.getMinute>>>();
    for (const code of ['2359', '1234', '0000']) {
      const minute = await provider.getMinute(code);
      // A canonical custom provider has the same trusted contract as bundled data.
      records.set(code, { ...minute, seconds: [...minute.seconds] });
    }
    const digits = FormulaClock.digits;
    FormulaClock.setDataProvider({
      async getMinute(hhmm) {
        return (
          records.get(hhmm) ?? { schema: 'formula-clock/1', hhmm, seconds: Array(60).fill(null) }
        );
      },
    });
    let checked = 0;
    for (const font of ['stix2', 'termes', 'fira', 'euler'] as const)
      for (const numerals of ['lining', 'oldstyle'] as const)
        for (const division of ['fraction', 'inline', 'slash'] as const) {
          await FormulaClock.setDisplay({ font, numerals, division });
          for (const [code, seconds] of [
            ['2359', 10],
            ['1234', 59],
            ['0000', 8],
          ] as const) {
            FormulaClock.preview(
              new Date(2026, 8, 12, Number(code.slice(0, 2)), Number(code.slice(2)), seconds),
              true,
            );
            const deadline = performance.now() + 5000;
            for (;;) {
              const state = FormulaClock.state,
                layout = state.layout;
              if (state.dataError || state.engineError) throw new Error(JSON.stringify(state));
              if (
                layout?.code === code &&
                layout.seconds === seconds &&
                layout.display.font === font &&
                layout.display.numerals === numerals &&
                layout.display.division === division &&
                state.coverage !== undefined
              ) {
                if (layout.ast !== records.get(code)!.seconds[seconds])
                  throw new Error('The provider AST was copied or replaced');
                if (!FormulaClock.digits.every((digit, index) => digit === digits[index]))
                  throw new Error('Persistent digits were replaced');
                if (!FormulaClock.diagnostics().glyphs.every((glyph) => glyph.inStage))
                  throw new Error('A digit is outside the stage');
                checked++;
                break;
              }
              if (performance.now() > deadline) throw new Error('Canonical frame did not render');
              await new Promise(requestAnimationFrame);
            }
          }
        }
    return checked;
  });
  assert.equal(count, 72);
});
