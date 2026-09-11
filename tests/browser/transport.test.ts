import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import * as playwright from 'playwright';
import type { Page } from 'playwright';
import { browserArgs, createReport, playwrightVersion } from '../helpers/browser.ts';
const args = browserArgs(import.meta.url, { browsers: ['chromium', 'webkit'], options: [] });
test('transport', { timeout: 900000 }, async (t) => {
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    playwright: playwrightVersion,
    checks: [],
    errors: [],
  });
  async function ready(page: Page, time: string) {
    await page.waitForFunction(
      script(
        't=>{const l=window.FormulaClock?.state.layout;return l&&l.code+String(l.seconds).padStart(2,"0")===t&&!document.querySelector("#share").disabled}',
      ),
      time,
      { timeout: 45000 },
    );
  }
  async function preview(page: Page, time: string) {
    await page.evaluate(script('t=>FormulaClock.preview(FormulaShare.localDate(t))'), time);
    await ready(page, time);
  }
  const browser = await playwright[args.browser].launch({ headless: true });
  t.after(() => browser.close());
  report['browserVersion'] = browser.version();
  for (const locale of ['ja-JP', 'en-US']) {
    const ctx = await browser.newContext({
      locale: locale,
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1440, height: 1000 },
    });
    await ctx.addInitScript(`const NativeDate=Date;
          window.testWall=+new NativeDate('2026-09-11T12:34:30.800+09:00');
          window.Date=class extends NativeDate {
            constructor(...args){super(...(args.length?args:[window.testWall]));}
            static now(){return window.testWall;}
          };`);
    const page = await ctx.newPage();
    page.on('pageerror', (error) => report['errors'].push(String(error)));
    await page.goto(args.url + '?t=123459', { waitUntil: 'domcontentloaded' });
    await ready(page, '123459');
    report['mathjax'] = await page.evaluate('FormulaClock.diagnostics().mathjax');
    assert.deepEqual(report['mathjax'], '4.1.3');
    await page.evaluate(
      'window.originalDigits=FormulaClock.digits;window.originalProvider=FORMULA_CLOCK_CONFIG.provider',
    );
    assert.deepEqual(await page.locator('#play-pause,#slow,#playback').count(), 0);
    assert.deepEqual(await page.locator('#transport button').count(), 1);
    assert.deepEqual(
      await page.locator('#go-live').innerText(),
      locale === 'ja-JP' ? '現在時刻へ' : 'Current time',
    );
    assert.deepEqual(
      await page.locator('.seek-hint').innerText(),
      locale === 'ja-JP' ? '← → 1秒ずつ移動' : '← → Step by 1 second',
    );
    let frozen = await page.evaluate<string>('FormulaClock.state.now');
    await page.waitForTimeout(1100);
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    // Arrow keys also work when a ruler button has keyboard focus.
    await page.locator('.tick').nth(59).click();
    // WebKit follows macOS and does not focus buttons on pointer clicks.
    await page.locator('.tick').nth(59).focus();
    assert.ok(await page.evaluate('document.activeElement.classList.contains("tick")'));
    await page.keyboard.press('ArrowRight');
    await ready(page, '123500');
    assert.ok(page.url() === args.url && (await page.evaluate('FormulaClock.state.paused')));
    await page.keyboard.press('ArrowLeft');
    await ready(page, '123459');
    await preview(page, '235959');
    await page.keyboard.press('ArrowRight');
    await ready(page, '000000');
    await page.keyboard.press('ArrowLeft');
    await ready(page, '235959');
    await preview(page, '123459');
    for (const _iteration of Array.from({ length: 12 }, (_, i) => i)) {
      await page.keyboard.down('ArrowRight');
    }
    await page.keyboard.up('ArrowRight');
    for (const _iteration of Array.from({ length: 4 }, (_, i) => i)) {
      await page.keyboard.press('ArrowLeft');
    }
    await ready(page, '123507');
    assert.ok(await page.evaluate('FormulaClock.state.paused'));
    report['checks'].push(
      locale + ': second/minute/day boundaries, focused ruler and held-key steps',
    );
    // A slower old minute response cannot overwrite the last requested time.
    await page.evaluate(`FormulaClock.setDataProvider({async getMinute(hhmm){
          if(hhmm==='1240')await new Promise(resolve=>setTimeout(resolve,350));
          return {schema:'formula-clock/1',hhmm,seconds:Array(60).fill(null)};
        }})`);
    await preview(page, '123959');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await ready(page, '123959');
    await page.waitForTimeout(550);
    await ready(page, '123959');
    await page.evaluate('FormulaClock.setDataProvider(originalProvider)');
    await preview(page, '123430');
    // Native form, dialog and button keys keep their own behavior.
    frozen = await page.evaluate<string>('FormulaClock.state.now');
    await page.click('#settings-open');
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.locator('#division-choice input:checked').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction('FormulaClock.state.display.division==="inline"', undefined);
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.locator('#custom-time').fill('12:34:30');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.click('#licenses-open');
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(
      'document.querySelector("#share-dialog").showModal();document.querySelector("#share-url").focus()',
    );
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.keyboard.press('Escape');
    await page.evaluate(
      'const el=document.createElement("div");el.id="editable-test";el.contentEditable="true";el.textContent="text";document.body.append(el);el.focus()',
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.evaluate('document.querySelector("#editable-test").remove()');
    for (const key of ['Control+ArrowRight', 'Shift+ArrowLeft']) {
      await page.keyboard.press(key);
    }
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.locator('#sound').focus();
    const before = await page.evaluate('FormulaClock.state.soundEnabled');
    await page.keyboard.press('Space');
    assert.notDeepEqual(await page.evaluate('FormulaClock.state.soundEnabled'), before);
    assert.deepEqual(await page.evaluate<string>('FormulaClock.state.now'), frozen);
    await page.click('#sound');
    report['checks'].push(
      locale + ': native radio/input/contenteditable/button keys and modal shortcuts do not seek',
    );
    await page.evaluate('document.activeElement.blur()');
    await page.keyboard.press('Space');
    await page.waitForFunction('!FormulaClock.state.preview', undefined);
    await ready(page, '123430');
    await page.keyboard.press('ArrowRight');
    assert.ok(!(await page.evaluate('FormulaClock.state.preview')));
    const displayed = await page.evaluate<string>(
      'FormulaClock.state.layout.code+String(FormulaClock.state.layout.seconds).padStart(2,"0")',
    );
    await page.keyboard.down('Space');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    assert.ok(await page.evaluate('FormulaClock.state.paused'));
    assert.ok(
      await page.evaluate(
        script(`()=>{const event=new KeyboardEvent('keydown',{key:' ',code:'Space',repeat:true,cancelable:true,bubbles:true});
          document.dispatchEvent(event);return event.defaultPrevented;}`),
      ),
    );
    await ready(page, displayed);
    await page.evaluate('testWall+=12000;FormulaClock.pause()');
    await page.waitForTimeout(1100);
    await ready(page, displayed);
    await page.keyboard.press('Space');
    await page.waitForFunction('!FormulaClock.state.preview', undefined);
    await ready(page, '123442');
    await page.evaluate('FormulaClock.pause()');
    await page.keyboard.press('l');
    assert.ok(!(await page.evaluate('FormulaClock.state.preview')));
    report['checks'].push(
      locale +
        ': Space freezes the displayed second, ignores repeats and returns to actual current time; pause API is idempotent',
    );
    await preview(page, '123430');
    await page
      .locator('#transport')
      .screenshot({ path: String(path.join(args.outputDir, locale + '-transport.png')) });
    for (const [time, font, mode] of [
      ['235910', 'termes', 'formula'] as const,
      ['022033', 'stix2', 'formula'] as const,
      ['085846', 'fira', 'formula'] as const,
      ['004159', 'euler', 'time'] as const,
    ]) {
      await page.evaluate(script('f=>FormulaClock.setDisplay({font:f,division:"fraction"})'), font);
      await preview(page, time);
      await page.waitForFunction(script('f=>FormulaClock.state.layout.display.font===f'), font, {
        timeout: 45000,
      });
      await page.waitForTimeout(750);
      assert.deepEqual(await page.evaluate('FormulaClock.state.layout.mode'), mode);
      assert.ok(
        await page.evaluate(
          'FormulaClock.digits.every((el,i)=>el===originalDigits[i]) && FormulaClock.diagnostics().glyphs.every(g=>g.inStage)',
        ),
      );
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(750);
    assert.ok(
      await page
        .locator('#transport')
        .evaluate(
          script(
            'el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}',
          ),
        ),
    );
    await page
      .locator('#transport')
      .screenshot({ path: String(path.join(args.outputDir, locale + '-transport-320.png')) });
    await page.click('#go-live');
    assert.ok(!(await page.evaluate('FormulaClock.state.preview')));
    assert.ok(await page.locator('#transport').isHidden());
    report['checks'].push(
      locale +
        ': fractions, powers, radical factorials, ordinary clock and four fonts retain digits; transport fits 320px',
    );
    await ctx.close();
  }
  await browser.close();
  assert.ok(!(report['errors'].length > 0), inspect(report['errors']));
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
  console.log(JSON.stringify(report, null, 2));
});
