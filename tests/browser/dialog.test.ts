import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';

for (const input of ['mouse', 'touch', 'backdrop-click-only'] as const) {
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

    if (input === 'backdrop-click-only') {
      // iOS 26.5 Safari sends click, but no pointer/touch start/end, for ::backdrop.
      // Reproduce that observed sequence in desktop engines as well.
      await page.evaluate(() => {
        for (const dialog of document.querySelectorAll('dialog')) {
          for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend']) {
            dialog.addEventListener(
              type,
              (event) => {
                const point =
                  'changedTouches' in event
                    ? (event as TouchEvent).changedTouches[0]
                    : (event as MouseEvent);
                const r = dialog.getBoundingClientRect();
                if (
                  point.clientX < r.left ||
                  point.clientX > r.right ||
                  point.clientY < r.top ||
                  point.clientY > r.bottom
                )
                  event.stopImmediatePropagation();
              },
              true,
            );
          }
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

    // Keyboard clicks on controls have no pointerdown and can have (0, 0) coordinates.
    // They must not be mistaken for a backdrop click.
    await activate('#settings-open');
    await page.locator('#licenses-open').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#licenses')).toBeVisible();
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#licenses')).toBeHidden();
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
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
    await page.mouse.move(title.x + 4, title.y + 4);
    await page.mouse.down();
    await page.mouse.move(8, 8, { steps: 5 });
    await page.mouse.up();
    await expect(settings).toBeVisible();
    // Browser scrolling cancels the pointer. It must not leave a stale drag guard
    // that blocks the next iOS backdrop click (which has no pointerdown to reset it).
    await page.locator('#settings-title').evaluate((element) => {
      const r = element.getBoundingClientRect();
      for (const type of ['pointerdown', 'pointercancel']) {
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: 'touch',
            clientX: r.left + 4,
            clientY: r.top + 4,
          }),
        );
      }
    });
    await expect(settings).toBeVisible();
    await backdrop();
    await expect(settings).toBeHidden();
    assert.ok(
      await page.evaluate(() => FormulaClock.digits.every((el, i) => el === originalDigits[i])),
    );
    assert.deepEqual(report.errors, []);
    report.checks.push(
      'Backdrop dismissal with and without pointerdown, panel controls, nested dialogs, focus restoration, no click-through, drag rejection and cancelled-pointer recovery',
    );
    fs.writeFileSync(path.join(args.outputDir, 'results.json'), JSON.stringify(report, null, 2));
    await ctx.close();
  });
}
