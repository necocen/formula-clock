import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';

for (const input of ['mouse', 'touch', 'touch-without-click'] as const) {
  test(`dialog-${input}`, async ({ browser, args }) => {
    const touch = input !== 'mouse';
    const ctx = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      hasTouch: touch,
      isMobile: touch && args.browser !== 'firefox',
    });
    const page = await ctx.newPage();
    const report = createReport({
      browser: args.browser,
      browserVersion: browser.version(),
      playwright: playwrightVersion,
      input,
      url: args.url,
    });
    page.on('pageerror', (error) => report.errors.push(String(error)));
    await page.goto(args.url + '?t=123430');
    await page.waitForFunction(() => window.FormulaClock?.state.layout);
    await page.evaluate(() => {
      window.originalDigits = FormulaClock.digits;
    });
    report.mathjax = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
    report.display = await page.evaluate(() => FormulaClock.state.display);

    if (input === 'touch-without-click') {
      // Model a touch sequence that does not deliver a compatibility click.
      await page.evaluate(() => {
        for (const dialog of document.querySelectorAll('dialog')) {
          dialog.addEventListener(
            'click',
            (event) => {
              if (event.target === dialog) event.stopImmediatePropagation();
            },
            true,
          );
        }
      });
    }
    const activate = (selector: string) =>
      touch ? page.locator(selector).tap() : page.locator(selector).click();
    const backdrop = () => (touch ? page.touchscreen.tap(8, 8) : page.mouse.click(8, 8));
    const settings = page.locator('#settings');
    const viewport = page.viewportSize()!;
    for (const [x, y] of [
      [8, 8],
      [8, viewport.height / 2],
      [viewport.width / 2, viewport.height - 8],
    ]) {
      await activate('#settings-open');
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(settings).toBeHidden();
      await expect(page.locator('#settings-open')).toBeFocused();
    }

    await activate('#settings-open');
    await activate('#settings-title');
    await expect(settings).toBeVisible();
    await activate('#advanced-settings summary');
    await expect(page.locator('#advanced-settings')).toHaveAttribute('open', '');
    await activate('#licenses-open');
    await backdrop();
    await expect(page.locator('#licenses')).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(page.locator('#licenses-open')).toBeFocused();
    await backdrop();
    await expect(settings).toBeHidden();

    // A dismissal over a toolbar button must not also activate that button.
    await activate('#settings-open');
    const sound = (await page.locator('#sound').boundingBox())!;
    const point = { x: sound.x + sound.width / 2, y: sound.y + sound.height / 2 };
    if (touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await expect(settings).toBeHidden();
    assert.equal(await page.evaluate(() => FormulaClock.state.soundEnabled), false);
    await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'false');

    await page.evaluate(() =>
      document.querySelector<HTMLDialogElement>('#share-dialog')!.showModal(),
    );
    await backdrop();
    await expect(page.locator('#share-dialog')).toBeHidden();
    await expect(page.locator('#share')).toBeFocused();

    await activate('#settings-open');
    const title = (await page.locator('#settings-title').boundingBox())!;
    if (!touch) {
      await page.mouse.move(title.x + 4, title.y + 4);
      await page.mouse.down();
      await page.mouse.move(8, 8, { steps: 5 });
      await page.mouse.up();
      await expect(settings).toBeVisible();
    } else {
      // Scrolling/dragging, cancelled gestures, and multiple fingers are not taps.
      for (const gesture of ['inside-out', 'move', 'cancel', 'multi']) {
        await settings.evaluate((dialog, gesture) => {
          const r = dialog.getBoundingClientRect();
          const makeTouch = (identifier: number, clientX: number, clientY: number) => ({
            identifier,
            target: dialog,
            clientX,
            clientY,
          });
          const start = makeTouch(1, gesture === 'inside-out' ? r.left + 20 : 8, 100);
          const end = makeTouch(1, 8, gesture === 'move' ? 300 : 100);
          // WebKit does not expose a constructible Touch. These synthetic gesture
          // sequences supplement the real touchscreen.tap checks above.
          const send = (
            type: string,
            touches: ReturnType<typeof makeTouch>[],
            changedTouches: ReturnType<typeof makeTouch>[],
          ) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.defineProperties(event, {
              touches: { value: touches },
              changedTouches: { value: changedTouches },
            });
            dialog.dispatchEvent(event);
          };
          send('touchstart', [start], [start]);
          if (gesture === 'multi')
            send('touchstart', [start, makeTouch(2, 8, 120)], [makeTouch(2, 8, 120)]);
          if (gesture === 'move') send('touchmove', [end], [end]);
          if (gesture === 'cancel') send('touchcancel', [], [start]);
          send('touchend', [], [end]);
        }, gesture);
        await expect(settings).toBeVisible();
      }
    }
    await backdrop();
    await expect(settings).toBeHidden();
    assert.ok(
      await page.evaluate(() => FormulaClock.digits.every((el, i) => el === originalDigits[i])),
    );
    assert.deepEqual(report.errors, []);
    report.checks.push(
      'Backdrop dismissal, panel controls, nested dialogs, focus restoration, no click-through, and gesture rejection',
    );
    fs.writeFileSync(path.join(args.outputDir, 'results.json'), JSON.stringify(report, null, 2));
    await ctx.close();
  });
}
