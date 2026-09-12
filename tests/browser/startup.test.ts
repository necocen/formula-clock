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
