import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';
test('fullscreen', async ({ browser, args }) => {
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    playwright: playwrightVersion,
    checks: [],
    errors: [],
  });
  report['browserVersion'] = browser.version();
  for (const scenario of ['native', 'unavailable', 'policy-disabled', 'rejected', 'prefixed']) {
    const ctx = await browser.newContext({
      locale: 'ja-JP',
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    if (['unavailable', 'policy-disabled'].includes(scenario)) {
      await ctx.addInitScript(() => {
        Object.defineProperty(document, 'fullscreenEnabled', { value: false });
        Object.defineProperty(document, 'webkitFullscreenEnabled', { value: false });
      });
    }
    if (scenario === 'unavailable') {
      await ctx.addInitScript(() => {
        Element.prototype.requestFullscreen = undefined as unknown as () => Promise<void>;
        (Element.prototype as HTMLElement).webkitRequestFullscreen = undefined;
      });
    }
    if (scenario === 'rejected') {
      await ctx.addInitScript(() => {
        Object.defineProperty(document, 'fullscreenEnabled', { value: true });
        Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Test rejection'));
      });
    }
    if (scenario === 'prefixed') {
      await ctx.addInitScript(() => {
        Object.defineProperty(document, 'fullscreenEnabled', { value: false });
        Object.defineProperty(document, 'webkitFullscreenEnabled', { value: true });
        Object.defineProperty(document, 'webkitFullscreenElement', {
          writable: true,
          value: null,
        });
        (Element.prototype as HTMLElement).webkitRequestFullscreen = function (this: Element) {
          document.webkitFullscreenElement = this;
          document.dispatchEvent(new Event('webkitfullscreenchange'));
        };
        document.webkitExitFullscreen = () => {
          document.webkitFullscreenElement = null;
          document.dispatchEvent(new Event('webkitfullscreenchange'));
        };
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (error) => report['errors'].push(String(error)));
    await page.goto(args.url + '?t=123430', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.FormulaClock, undefined);
    const button = page.locator('#fullscreen');
    if (['unavailable', 'policy-disabled'].includes(scenario)) {
      assert.ok(await button.isHidden());
      await page.keyboard.press('f');
      assert.ok(!(await page.evaluate(() => document.body.classList.contains('fullscreen'))));
      assert.ok(
        !(await page.evaluate(
          () => document.fullscreenElement || document.webkitFullscreenElement,
        )),
      );
    } else {
      if (scenario === 'rejected') {
        assert.ok(await button.isVisible());
        await page.click('#fullscreen');
        await page.waitForFunction(
          () =>
            document
              .querySelector('#share-status')!
              .textContent!.includes('切り替えられませんでした'),
          undefined,
        );
        assert.deepEqual(await button.getAttribute('aria-pressed'), 'false');
        assert.ok(!(await page.evaluate(() => document.body.classList.contains('fullscreen'))));
      } else {
        if (await button.isVisible()) {
          await page.click('#fullscreen');
          await page.waitForFunction(
            () => document.fullscreenElement || document.webkitFullscreenElement,
            undefined,
          );
          assert.deepEqual(await button.getAttribute('aria-pressed'), 'true');
          assert.deepEqual(await button.getAttribute('aria-label'), '全画面表示を終了');
          await page.click('#fullscreen');
          await page.waitForFunction(
            () => !document.fullscreenElement && !document.webkitFullscreenElement,
            undefined,
          );
          assert.deepEqual(await button.getAttribute('aria-pressed'), 'false');
        } else {
          assert.deepEqual(scenario, 'native');
          report['nativeUnavailable'] = true;
        }
      }
    }
    if (scenario === 'native') {
      await page.waitForFunction(
        () =>
          FormulaClock.state.layout &&
          !document.querySelector<HTMLButtonElement>('#share')!.disabled,
        undefined,
        { timeout: 45000 },
      );
      report['mathjax'] = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
      for (const [t, font, mode] of [
        ['235910', 'stix2', 'formula'] as const,
        ['123459', 'fira', 'formula'] as const,
        ['004159', 'euler', 'time'] as const,
      ]) {
        await page.evaluate(
          ([t, font]) => {
            FormulaClock.setDisplay({ font });
            FormulaClock.preview(FormulaShare.localDate(t), true);
          },
          [t, font] as const,
        );
        await page.waitForFunction(
          ([t, font]) => {
            const l = FormulaClock.state.layout;
            return (
              l?.code === t.slice(0, 4) &&
              l.seconds === Number(t.slice(4)) &&
              l.display.font === font &&
              !document.querySelector<HTMLButtonElement>('#share')!.disabled
            );
          },
          [t, font] as const,
          { timeout: 45000 },
        );
        assert.deepEqual(await page.evaluate(() => FormulaClock.state.layout!.mode), mode);
        assert.ok(
          await page.evaluate(() => FormulaClock.diagnostics().glyphs.every((g) => g.inStage)),
        );
      }
      report['checks'].push(
        'CDN fractions, exponent, ordinary clock and font changes remain visible at 390px',
      );
    }
    report['checks'].push(scenario);
    await page.screenshot({ path: String(path.join(args.outputDir, scenario + '.png')) });
    await ctx.close();
  }
  assert.ok(!(report['errors'].length > 0), inspect(report['errors']));
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
