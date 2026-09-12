import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import type { DisplayOptions } from '../../src/shared/types.ts';
import { renderLicenses } from '../../tools/licenses.ts';
import { test, createReport, playwrightVersion, decodeHtml } from '../helpers/browser.ts';
declare global {
  var copied: string | null;
}
test('i18n', async ({ browser, args }) => {
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    playwright: playwrightVersion,
    checks: [],
    errors: [],
  });
  const saved: DisplayOptions = {
    font: 'fira',
    numerals: 'lining',
    division: 'inline',
    symbolMotion: true,
    structureMotion: true,
    symbolMorph: false,
  };
  const legal = [
    ...(await renderLicenses()).matchAll(new RegExp('<pre(?: [^>]*)?>(.*?)</pre>', 'gs')),
  ]
    .map((match) => match[1])
    .map((text) => decodeHtml(text).replace(/^\n/, ''));
  const query = '?v=1&t=123430&font=stix2&numerals=oldstyle&division=fraction';
  let licenseContent = null;
  report['browserVersion'] = browser.version();
  for (const language of ['ja-JP', 'en-US', 'fr-FR']) {
    const locale = language === 'ja-JP' ? 'ja' : 'en';
    const ctx = await browser.newContext({
      locale: language,
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 390, height: 844 },
    });
    await ctx.addInitScript((value) => {
      localStorage.setItem('formula-clock-display-v2', value);
    }, JSON.stringify(saved));
    if (language === 'fr-FR') {
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'languages', { value: ['fr-FR', 'ja-JP'] });
      });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (error) => report['errors'].push(String(error)));
    await page.goto(args.url + query, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => window.FormulaClock && !document.querySelector<HTMLButtonElement>('#share')!.disabled,
      undefined,
      { timeout: 45000 },
    );
    assert.deepEqual(await page.locator('html').getAttribute('lang'), locale);
    assert.deepEqual(await page.evaluate(() => FormulaClock.diagnostics().locale), locale);
    assert.ok(await page.evaluate(() => FormulaClock.state.paused && FormulaClock.state.preview));
    assert.deepEqual(
      await page.evaluate(
        () => FormulaClock.state.layout!.code + String(FormulaClock.state.layout!.seconds),
      ),
      '123430',
    );
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem('formula-clock-display-v2')!)),
      saved,
    );
    assert.deepEqual(await page.evaluate(() => FormulaClock.state.display.font), 'stix2');
    report['mathjax'] = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
    assert.deepEqual(report['mathjax'], '4.1.3');
    await page.evaluate(() => {
      window.originalDigits = FormulaClock.digits;
    });
    await page.click('#settings-open');
    assert.deepEqual(
      await page.locator('#settings-title').innerText(),
      locale === 'ja' ? '設定' : 'Settings',
    );
    assert.deepEqual(
      await page.locator('#font-choice').getAttribute('aria-label'),
      locale === 'ja' ? '数式のフォント' : 'Formula font',
    );
    await page.click('#advanced-settings > summary');
    if (locale === 'en') {
      assert.ok(
        !new RegExp('[ぁ-んァ-ヶ一-龠]').exec(await page.locator('#settings').innerText())!,
      );
    }
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width: width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await page.locator('#settings').evaluate((el) => el.scrollWidth <= el.clientWidth));
      assert.ok((await page.locator('#structure-motion').boundingBox())!['width'] >= 15);
      await page.screenshot({
        path: String(path.join(args.outputDir, `${language}-settings-${width}.png`)),
      });
    }
    await page.click('#licenses-open');
    assert.deepEqual(await page.locator('#licenses-title').innerText(), 'LICENSE');
    assert.deepEqual(await page.locator('.license-content pre').allTextContents(), legal);
    assert.deepEqual(await page.locator('.license-content').getAttribute('lang'), 'ja');
    if (licenseContent === null) {
      licenseContent = await page.locator('.license-content').textContent();
    }
    assert.deepEqual(await page.locator('.license-content').textContent(), licenseContent);
    await page.setViewportSize({ width: 320, height: 844 });
    await page
      .locator('.license-content details')
      .evaluateAll((elements: HTMLDetailsElement[]) => elements.forEach((el) => (el.open = true)));
    assert.ok(
      await page
        .locator('#licenses')
        .evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight > el.clientHeight),
    );
    await page.screenshot({ path: path.join(args.outputDir, `${language}-licenses-320.png`) });
    await page.click('#licenses-close');
    assert.ok(await page.locator('#licenses-open').evaluate((el) => el === document.activeElement));
    await page.click('#licenses-open');
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#licenses-open').evaluate((el) => el === document.activeElement));
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (url: string) => {
            window.copied = url;
          },
        },
      });
    });
    await page.click('#share');
    await page.waitForFunction(() => window.copied, undefined);
    assert.deepEqual(await page.evaluate(() => new URL(copied!).search), '');
    assert.ok(
      new RegExp('^(?:' + '/s/[A-Za-z0-9]{10}' + ')$').exec(
        await page.evaluate(() => new URL(copied!).pathname),
      )!,
    );
    assert.deepEqual(
      await page.locator('#share-status').innerText(),
      locale === 'ja' ? '共有URLをコピーしました' : 'Share link copied',
    );
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('Test denial')) },
      });
    });
    await page.click('#share');
    assert.deepEqual(
      await page.locator('#share-title').innerText(),
      locale === 'ja' ? 'Share' : 'Share this view',
    );
    await page.keyboard.press('Escape');
    assert.deepEqual(await page.locator('#play-pause,#slow').count(), 0);
    assert.deepEqual(await page.locator('#transport button').count(), 1);
    assert.deepEqual(
      await page.locator('#go-live').innerText(),
      locale === 'ja' ? '現在時刻へ' : 'Current time',
    );
    assert.deepEqual(
      await page.locator('.seek-hint').innerText(),
      locale === 'ja' ? '← → 1秒ずつ移動' : '← → Step by 1 second',
    );
    assert.ok(await page.evaluate(() => FormulaClock.state.paused));
    for (const [time, font, mode] of [
      ['235910', 'stix2', 'formula'] as const,
      ['235910', 'termes', 'formula'] as const,
      ['123459', 'fira', 'formula'] as const,
      ['004159', 'euler', 'time'] as const,
    ]) {
      await page.evaluate(
        ([time, font]) => {
          FormulaClock.setDisplay({ font });
          FormulaClock.preview(FormulaShare.localDate(time), true);
        },
        [time, font] as [string, DisplayOptions['font']],
      );
      // A cache miss may first render this time as a loading clock.
      // Sharing is enabled only once data and the final frame are ready.
      await page.waitForFunction(
        ([time, font]) => {
          const l = FormulaClock.state.layout;
          return (
            l?.code === time.slice(0, 4) &&
            l.seconds === Number(time.slice(4)) &&
            l.display.font === font &&
            !document.querySelector<HTMLButtonElement>('#share')!.disabled
          );
        },
        [time, font] as [string, DisplayOptions['font']],
        { timeout: 45000 },
      );
      assert.deepEqual(
        await page.evaluate(() => FormulaClock.state.layout!.mode),
        mode,
        inspect(await page.evaluate(() => FormulaClock.state)),
      );
      assert.ok(
        await page.evaluate(() =>
          FormulaClock.digits.every((digit, i) => digit === originalDigits[i]),
        ),
      );
      assert.ok(
        await page.evaluate(() => FormulaClock.diagnostics().glyphs.every((g) => g.inStage)),
      );
    }
    await page.evaluate(() =>
      FormulaClock.setDataProvider({
        getMinute: async () => {
          throw new Error('Test data failure');
        },
      }),
    );
    await page.waitForFunction(() => FormulaClock.state.dataError, undefined);
    assert.deepEqual(
      await page.locator('#state-label').textContent(),
      locale === 'ja'
        ? '式データを読み込めなかった。通常の時計を表示中。'
        : 'Could not load formula data. Showing the clock.',
    );
    report['checks'].push({
      language: language,
      locale: locale,
      savedPreferencesUnchanged: true,
      shortShareUrl: true,
      settingsControlsAndMessages: true,
      legalTextUnchanged: true,
      licenseExplanationsAlwaysJapanese: true,
      narrowWidths: [320, 390, 768],
      persistentDigitsAndLayouts: true,
    });
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
