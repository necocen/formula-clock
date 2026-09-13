import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';

test('viewport fits portrait and short landscape screens', async ({ browser, args }) => {
  const sizes = [
    { width: 844, height: 290 },
    { width: 667, height: 245 },
    { width: 320, height: 480 },
    { width: 390, height: 664 },
    { width: 844, height: 390 },
    { width: 844, height: 620 },
    { width: 1440, height: 1000 },
  ];
  const profiles = (['stix2', 'termes', 'fira', 'euler'] as const).flatMap((font) =>
    (['oldstyle', 'lining'] as const).map((numerals) => ({ font, numerals })),
  );
  const ctx = await browser.newContext({
    viewport: sizes[0],
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    isMobile: args.browser !== 'firefox',
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false });
    Object.defineProperty(document, 'webkitFullscreenEnabled', { value: false });
  });
  const page = await ctx.newPage();
  const report = createReport({
    browser: args.browser,
    browserVersion: browser.version(),
    playwright: playwrightVersion,
    url: args.url,
  });
  page.on('pageerror', (error) => report.errors.push(String(error)));
  await page.goto(args.url + '?t=235910');
  await page.waitForFunction(() => window.FormulaClock?.state.layout);
  report.mathjax = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
  const originals = await page.evaluateHandle(() => [
    ...FormulaClock.digits,
    document.querySelector('#equal-sign'),
    ...document.querySelectorAll('#source-time .source-digit'),
  ]);

  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const display of profiles) {
      const { font, numerals } = display;
      await page.evaluate((display) => FormulaClock.setDisplay(display), display);
      for (const time of ['235910', '123459', '000008']) {
        await page.evaluate(
          (time) => FormulaClock.preview(FormulaShare.localDate(time), true),
          time,
        );
        await page.waitForFunction(
          ([font, numerals, time]) => {
            const layout = FormulaClock.state.layout;
            return (
              layout?.display.font === font &&
              layout.display.numerals === numerals &&
              layout.code === time.slice(0, 4) &&
              layout.seconds === Number(time.slice(4))
            );
          },
          [font, numerals, time] as const,
        );
        // ResizeObserver and the renderer may finish in different animation frames.
        await expect
          .poll(() =>
            page.evaluate(() => {
              const stage = document.querySelector('#stage')!.getBoundingClientRect();
              const layout = FormulaClock.state.layout!;
              return Math.abs(layout.axisY - stage.height / 2);
            }),
          )
          .toBeLessThan(0.6);
        const geometry = await page.evaluate(() => {
          const box = (el: Element) => el.getBoundingClientRect().toJSON();
          const viewport = { width: innerWidth, height: innerHeight };
          const inside = (el: Element) => {
            const r = el.getBoundingClientRect();
            return (
              r.left >= -1 &&
              r.top >= -1 &&
              r.right <= innerWidth + 1 &&
              r.bottom <= innerHeight + 1
            );
          };
          const elements = [
            ...document.querySelectorAll(
              '.topbar, #source-time, #stage, .minute, #transport, .tools button:not([hidden])',
            ),
          ];
          const stage = document.querySelector('#stage')!.getBoundingClientRect();
          const ink = [...document.querySelectorAll<SVGGraphicsElement>('#math-scene > g')]
            .filter((el) => getComputedStyle(el).opacity !== '0')
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0);
          const equal = document.querySelector('#equal-sign')!.getBoundingClientRect();
          const header = ['.brand', '#source-time', '.tools']
            .map((selector) => document.querySelector(selector)!)
            .filter((el) => getComputedStyle(el).visibility !== 'hidden')
            .map((el) => el.getBoundingClientRect());
          return {
            viewport,
            scroll: {
              width: document.documentElement.scrollWidth,
              height: document.documentElement.scrollHeight,
            },
            stage: box(document.querySelector('#stage')!),
            equalAxisError:
              FormulaClock.state.layout!.mode === 'formula'
                ? Math.abs((equal.top + equal.bottom) / 2 - stage.top - stage.height / 2)
                : 0,
            headerFits: header.every((a, i) =>
              header
                .slice(i + 1)
                .every(
                  (b) =>
                    a.right <= b.left ||
                    b.right <= a.left ||
                    a.bottom <= b.top ||
                    b.bottom <= a.top,
                ),
            ),
            elements: elements.map((el) => ({
              name: el.id || el.className,
              box: box(el),
              inside: inside(el),
            })),
            inkFits: ink.every(
              (r) =>
                r.left >= stage.left - 1 &&
                r.right <= stage.right + 1 &&
                r.top >= stage.top - 1 &&
                r.bottom <= stage.bottom + 1,
            ),
          };
        });
        report.cases.push({ size, font, numerals, time, geometry });
        await page.screenshot({
          path: path.join(
            args.outputDir,
            `${size.width}x${size.height}-${font}-${numerals}-${time}.png`,
          ),
        });
        assert.ok(
          geometry.elements.every((el) => el.inside),
          JSON.stringify(geometry),
        );
        assert.ok(geometry.scroll.width <= size.width + 1, JSON.stringify(geometry));
        assert.ok(geometry.scroll.height <= size.height + 1, JSON.stringify(geometry));
        assert.ok(geometry.inkFits, JSON.stringify(geometry));
        assert.ok(geometry.equalAxisError < 0.12, JSON.stringify(geometry));
        assert.ok(geometry.headerFits, JSON.stringify(geometry));
        assert.ok(
          await page.evaluate((originals) => {
            const current = [
              ...FormulaClock.digits,
              document.querySelector('#equal-sign'),
              ...document.querySelectorAll('#source-time .source-digit'),
            ];
            return current.every((el, i) => el === originals[i]);
          }, originals),
        );
      }
    }
    await page.locator('#settings-open').tap();
    const dialog = await page.locator('#settings').boundingBox();
    assert.ok(
      dialog &&
        dialog.x >= 0 &&
        dialog.y >= 0 &&
        dialog.x + dialog.width <= size.width + 1 &&
        dialog.y + dialog.height <= size.height + 1,
    );
    await page.locator('#settings-close').tap();
    await expect(page.locator('#settings')).toBeHidden();
    for (const selector of ['#licenses', '#share-dialog']) {
      await page.locator(selector).evaluate((el: HTMLDialogElement) => el.showModal());
      const box = await page.locator(selector).boundingBox();
      assert.ok(
        box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= size.width + 1 &&
          box.y + box.height <= size.height + 1,
      );
      await page.locator(selector).evaluate((el: HTMLDialogElement) => el.close());
    }
    const stageBefore = await page.locator('#stage').boundingBox();
    await page.locator('#go-live').tap();
    await expect(page.locator('#transport')).toBeHidden();
    assert.deepEqual(await page.locator('#stage').boundingBox(), stageBefore);
  }
  assert.deepEqual(report.errors, []);
  fs.writeFileSync(path.join(args.outputDir, 'results.json'), JSON.stringify(report, null, 2));
  await ctx.close();
});
