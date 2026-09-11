import { sharedSnapshot } from '../helpers/share-response.ts';
import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import * as playwright from 'playwright';
import type { DisplayOptions, ClockState } from '../../src/shared/types.ts';
import { browserArgs, createReport, playwrightVersion } from '../helpers/browser.ts';
const args = browserArgs(import.meta.url, {
  browsers: ['chromium', 'firefox', 'webkit'],
  options: [],
});
test('share', { timeout: 900000 }, async (t) => {
  const output = args.outputDir;
  const saved: DisplayOptions = {
    font: 'fira',
    numerals: 'lining',
    division: 'inline',
    symbolMotion: true,
    structureMotion: true,
    symbolMorph: true,
  };
  const checks: string[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  const report = createReport({
    command: process.argv,
    browser: args.browser,
    playwright: playwrightVersion,
    node: process.version,
    at: new Date().toISOString(),
    checks: checks,
    errors: errors,
    requests: requests,
  });
  const browser = await playwright[args.browser].launch({ headless: true });
  t.after(() => browser.close());
  report['browserVersion'] = browser.version();
  const ctx = await browser.newContext({
    locale: 'ja-JP',
    viewport: { width: 1200, height: 800 },
    timezoneId: 'Asia/Tokyo',
  });
  await ctx.addInitScript(
    "localStorage.setItem('formula-clock-display-v2'," +
      JSON.stringify(JSON.stringify(saved)) +
      ");localStorage.setItem('formula-clock-audio-v1',JSON.stringify({enabled:true,volume:.25}));",
  );
  // Observe the real fetch instead of Playwright routing, which can stall
  // MathJax's dynamically imported blob modules in WebKit.
  await ctx.addInitScript(`window.shareLoadingChecks=[];const originalFetch=window.fetch;
      window.fetch=function(input,...args){
        if(String(input?.url||input).includes('/data/hours/')){
          shareLoadingChecks.push(document.querySelector('#share').disabled && FormulaClock.state.preview && FormulaClock.state.paused);
        }
        return originalFetch.call(this,input,...args);
      };`);
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(args.url + '?v=1&t=123430&font=stix2&numerals=oldstyle&division=fraction', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction('window.FormulaClock', undefined);
  const initial = await page.evaluate<ClockState>('FormulaClock.state');
  assert.ok(initial['preview'] && initial['paused'] && initial['display']['font'] === 'stix2');
  assert.deepEqual(await page.evaluate('new Date(FormulaClock.state.now).getHours()'), 12);
  assert.deepEqual(
    await page.evaluate<DisplayOptions>(
      'JSON.parse(localStorage.getItem("formula-clock-display-v2"))',
    ),
    saved,
  );
  try {
    await page.waitForFunction('!document.querySelector("#share").disabled', undefined, {
      timeout: 45000,
    });
  } catch (error) {
    report['startup'] = await page.evaluate(
      '({state:FormulaClock.state,diagnostics:FormulaClock.diagnostics()})',
    );
    report['loadingChecks'] = await page.evaluate<boolean[]>('shareLoadingChecks');
    fs.writeFileSync(
      path.join(output, 'failure.json'),
      JSON.stringify(report, null, 2) +
        `
`,
    );
    await page.screenshot({ path: String(path.join(output, 'failure.png')) });
    throw error;
  }
  const loadingChecks = await page.evaluate<boolean[]>('shareLoadingChecks');
  assert.ok(loadingChecks.length > 0 && loadingChecks.every(Boolean));
  assert.deepEqual(
    await page.evaluate(
      'FormulaClock.state.layout.code+String(FormulaClock.state.layout.seconds).padStart(2,"0")',
    ),
    '123430',
  );
  assert.deepEqual(await page.evaluate<number>('FormulaClock.state.audio.length'), 0);
  checks.push(
    'Shared state is applied before the first engine/frame; loading disables sharing; saved display/audio preferences stay intact',
  );
  await page.evaluate(
    script(`() => {
      window.originalShareDigits=FormulaClock.digits;
      window.shared=[];
      document.querySelector('#share').addEventListener('click',()=>{
        const l=FormulaClock.state.layout;window.beforeShare=l.code+String(l.seconds).padStart(2,'0');
      },true);
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
        window.shared.push({...data,activation:navigator.userActivation?.isActive,paused:FormulaClock.state.paused});return Promise.resolve();
      }});
    }`),
  );
  await page.evaluate("FormulaClock.preview('2000-01-15T12:34:31',false)");
  await page.waitForFunction('FormulaClock.state.layout.seconds===31', undefined);
  await page.click('#share');
  await page.waitForFunction(
    'shared.length || document.querySelector("#share-dialog").open',
    undefined,
  );
  if (await page.locator('#share-dialog').isVisible()) {
    await page.click('#share-native');
    await page.keyboard.press('Escape');
  }
  const actual = await page.evaluate<{
    call: { paused: boolean; activation?: boolean; url: string };
    before: string;
    state: ClockState;
  }>('({call:shared.at(-1),before:beforeShare,state:FormulaClock.state})');
  assert.ok(actual.state.layout);
  assert.ok(actual['call']['paused'] && actual['state']['paused']);
  assert.notDeepEqual(actual['call']['activation'], false);
  assert.ok(new RegExp('/s/[A-Za-z0-9]{10}$').exec(actual['call']['url'])!);
  // The sheet opens on ID acceptance, before the background KV write finishes.
  await page.waitForTimeout(2000);
  const sharedHtml = await (await ctx.request.get(actual['call']['url'])).text();
  const restored = sharedSnapshot(sharedHtml);
  assert.deepEqual(restored, {
    v: 1,
    t: actual['before'],
    font: 'stix2',
    numerals: 'oldstyle',
    division: 'fraction',
    ast: actual['state']['layout']['ast'],
  });
  assert.deepEqual(await page.evaluate('location.pathname+location.search'), '/');
  const audioCount = actual['state']['audio'].length;
  await page.waitForTimeout(850);
  assert.deepEqual(await page.evaluate<number>('FormulaClock.state.audio.length'), audioCount);
  assert.ok(await page.evaluate('FormulaClock.digits.every((d,i)=>d===originalShareDigits[i])'));
  assert.deepEqual(
    await page.evaluate(
      'FormulaClock.state.layout.code+String(FormulaClock.state.layout.seconds).padStart(2,"0")',
    ),
    actual['before'],
  );
  checks.push(
    'Sharing freezes the displayed second synchronously, keeps digit objects, cancels audio, and preserves native user activation',
  );
  await page.evaluate(
    "Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.reject(new DOMException('cancelled','AbortError'))})",
  );
  await page.click('#share');
  await page.waitForTimeout(100);
  assert.ok(
    (await page.locator('#share-dialog').isHidden()) &&
      (await page.locator('#share-status').innerText()) === '',
  );
  assert.ok(await page.evaluate('FormulaClock.state.paused'));
  await page.evaluate(
    script(`() => {
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:url=>{window.copied=url;return Promise.resolve();}}});
      Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.reject(new Error('unavailable'))});
    }`),
  );
  await page.click('#share');
  await page.waitForFunction('document.querySelector("#share-dialog").open', undefined);
  await page.click('#share-copy');
  await page.waitForFunction('window.copied', undefined);
  assert.deepEqual(await page.locator('#share-status').innerText(), '共有URLをコピーしました');
  await page.keyboard.press('Escape');
  await page.evaluate(
    "Object.defineProperty(navigator,'share',{configurable:true,value:undefined});window.copied=null",
  );
  await page.click('#share');
  await page.waitForFunction('window.copied', undefined);
  await page.evaluate(
    "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}})",
  );
  await page.click('#share');
  assert.ok(await page.locator('#share-dialog').isVisible());
  assert.deepEqual(await page.evaluate('document.activeElement.id'), 'share-url');
  assert.ok(
    await page
      .locator('#share-url')
      .evaluate(script('(input)=>input.selectionEnd-input.selectionStart===input.value.length')),
  );
  await page.keyboard.press('Escape');
  assert.ok(
    (await page.locator('#share-dialog').isHidden()) &&
      (await page.evaluate('document.activeElement.id')) === 'share',
  );
  checks.push(
    'Native cancellation stays quiet; failed native sharing offers share/copy controls; unavailable native sharing copies; clipboard failure opens a selected URL with focus restored on close',
  );
  await page.click('#go-live');
  assert.ok(!(await page.evaluate('FormulaClock.state.preview')));
  assert.ok(await page.locator('#transport').isHidden());
  await page.evaluate("FormulaClock.preview('2000-01-15T00:41:59',true)");
  await page.waitForFunction(
    'FormulaClock.state.layout.code==="0041" && FormulaClock.state.layout.seconds===59 && !document.querySelector("#share").disabled',
    undefined,
  );
  assert.deepEqual(await page.evaluate('FormulaClock.state.layout.mode'), 'time');
  await page.evaluate(
    "Object.defineProperty(navigator,'share',{configurable:true,value:data=>{window.nullShared=data;return Promise.resolve();}})",
  );
  await page.click('#share');
  await page.waitForFunction(
    'window.nullShared || document.querySelector("#share-dialog").open',
    undefined,
  );
  if (await page.locator('#share-dialog').isVisible()) {
    await page.click('#share-native');
    await page.keyboard.press('Escape');
  }
  const nullHtml = await (
    await ctx.request.get(await page.evaluate<string>('nullShared.url'))
  ).text();
  const nullSnapshot = sharedSnapshot(nullHtml);
  assert.ok(nullSnapshot['t'] === '004159' && nullSnapshot['ast'] === null);
  checks.push(
    'Shared preview returns to live mode; a legitimate null expression is shareable as the ordinary clock',
  );
  for (const width of [320, 390, 768, 1200]) {
    await page.setViewportSize({ width: width, height: 800 });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),
      inspect(width),
    );
    assert.ok(await page.locator('#share').isVisible());
    await page.screenshot({ path: String(path.join(output, `share-${width}.png`)) });
  }
  checks.push('Header and controls remain usable at 320/390/768/1200 pixels');
  report['mathjax'] = await page.evaluate('FormulaClock.diagnostics().mathjax');
  assert.deepEqual(report['mathjax'], '4.1.3');
  for (const zone of ['America/Los_Angeles', 'Europe/London']) {
    const other = await browser.newContext({ locale: 'ja-JP', timezoneId: zone });
    const target = await other.newPage();
    await target.goto(args.url + '?t=023000', { waitUntil: 'domcontentloaded' });
    await target.waitForFunction('window.FormulaClock', undefined);
    assert.deepEqual(
      await target.evaluate(
        '[new Date(FormulaClock.state.now).getHours(),new Date(FormulaClock.state.now).getMinutes(),FormulaClock.state.paused]',
      ),
      [2, 30, true],
    );
    await other.close();
  }
  checks.push('Recipient timezone does not change HH:MM:SS');
  await ctx.close();
  await browser.close();
  assert.ok(!(errors.length > 0), inspect(errors));
  fs.writeFileSync(
    path.join(output, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
  console.log(
    JSON.stringify(
      { browser: args.browser, version: report['browserVersion'], checks: checks, errors: errors },
      null,
      2,
    ),
  );
});
