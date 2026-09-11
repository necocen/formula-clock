import { shareId, sharedSnapshot } from '../helpers/share-response.ts';
import { script } from '../helpers/browser-script.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import * as playwright from 'playwright';
import type { Page, BrowserContext } from 'playwright';
import type { Expr, DisplayOptions, SharedSnapshot } from '../../src/shared/types.ts';
import { browserArgs, createReport, playwrightVersion } from '../helpers/browser.ts';
const args = browserArgs(import.meta.url, {
  browsers: ['chromium', 'firefox', 'webkit'],
  options: [],
});
test('kv-share', { timeout: 900000 }, async (t) => {
  const report = createReport({
    command: process.argv,
    at: new Date().toISOString(),
    browser: args.browser,
    playwright: playwrightVersion,
    checks: [],
    errors: [],
  });
  // Deliberately different from the selected dataset's (1+2)×(3+4)=21.
  const ast: Expr = {
    op: 'add',
    a: { op: 'lit', i: 0, j: 1 },
    b: {
      op: 'mul',
      a: { op: 'add', a: { op: 'lit', i: 1, j: 2 }, b: { op: 'lit', i: 2, j: 3 } },
      b: { op: 'lit', i: 3, j: 4 },
    },
  };
  const snapshot: SharedSnapshot = {
    v: 1,
    t: '123421',
    font: 'stix2',
    numerals: 'oldstyle',
    division: 'fraction',
    ast: ast,
  };
  const saved = {
    font: 'fira',
    numerals: 'lining',
    division: 'inline',
    symbolMotion: false,
    structureMotion: false,
    symbolMorph: false,
  };
  async function ready(page: Page, time: string) {
    await page.waitForFunction(
      script(
        'time=>{const l=window.FormulaClock?.state.layout;return l && l.code+String(l.seconds).padStart(2,"0")===time && !document.querySelector("#share").disabled}',
      ),
      time,
      { timeout: 45000 },
    );
  }
  async function readSnapshot(ctx: BrowserContext, url: string) {
    // Acceptance precedes persistence. Allow the asynchronous write to finish
    // before testing restoration (the gated Worker test covers early acceptance).
    await delay(2 * 1000);
    const html = await (await ctx.request.get(url)).text();
    return sharedSnapshot(html);
  }
  const browser = await playwright[args.browser].launch({ headless: true });
  t.after(() => browser.close());
  report['browserVersion'] = browser.version();
  const ctx = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1200, height: 800 },
  });
  await ctx.addInitScript(
    'localStorage.setItem("formula-clock-display-v2",' +
      JSON.stringify(JSON.stringify(saved)) +
      ');',
  );
  // Fetch interception avoids WebKit route stalls on MathJax blob imports.
  await ctx.addInitScript(`window.postBodies=[];window.shareMode='normal';window.nativeCalls=[];window.copies=[];
      const originalFetch=window.fetch;
      window.fetch=async function(input,init){
        if(String(input?.url||input)==='/api/shares'){
          postBodies.push(JSON.parse(init.body));
          if(shareMode==='fail') return new Response('{}',{status:503});
          if(shareMode==='slow') await new Promise(resolve=>setTimeout(resolve,6000));
        }
        return originalFetch.call(this,input,init);
      };
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
        nativeCalls.push({...data,activation:navigator.userActivation.isActive});return Promise.resolve();
      }});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async url=>{copies.push(url);}}});
    `);
  const created = await ctx.request.post(args.url + 'api/shares', { data: snapshot });
  assert.deepEqual(created.status(), 202, inspect(await created.text()));
  const url = args.url + 's/' + shareId(await created.json());
  assert.deepEqual(await readSnapshot(ctx, url), snapshot);
  const page = await ctx.newPage();
  page.on('pageerror', (error) => report['errors'].push(String(error)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page, '123421');
  assert.deepEqual(await page.evaluate<Expr | null>('FormulaClock.state.layout.ast'), ast);
  assert.deepEqual(await page.title(), '1 + (2 + 3) × 4 = 21');
  assert.deepEqual(
    await page.locator('meta[property="og:title"]').getAttribute('content'),
    'Formula Clock - 12:34:21',
  );
  assert.deepEqual(
    await page.locator('meta[property="og:description"]').getAttribute('content'),
    '1+(2+3)×4=21',
  );
  assert.ok(await page.evaluate('FormulaClock.state.preview && FormulaClock.state.paused'));
  assert.deepEqual(
    await page.evaluate<DisplayOptions>(
      'JSON.parse(localStorage.getItem("formula-clock-display-v2"))',
    ),
    saved,
  );
  assert.deepEqual(page.url(), url);
  assert.deepEqual(
    await page.evaluate('new URL("data/manifest.json",document.baseURI).pathname'),
    '/data/manifest.json',
  );
  const current = await page.evaluate(
    script('async()=> (await FORMULA_CLOCK_CONFIG.provider.getMinute("1234")).seconds[21]'),
  );
  assert.notDeepEqual(
    current,
    ast,
    inspect('Fixture must differ from the current formula dataset'),
  );
  await page.evaluate(
    'window.sameDocument=true;window.initialHistoryLength=history.length;window.originalDigits=FormulaClock.digits',
  );
  await page.click('#share');
  assert.deepEqual(await page.evaluate<string>('nativeCalls.at(-1).url'), url);
  assert.deepEqual(await page.evaluate('nativeCalls.at(-1).title'), 'Formula Clock - 12:34:21');
  assert.ok(await page.evaluate('!("text" in nativeCalls.at(-1))'));
  assert.ok(await page.evaluate('nativeCalls.at(-1).activation'));
  assert.deepEqual(await page.evaluate<number>('postBodies.length'), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, '123421');
  assert.deepEqual(await page.evaluate<Expr | null>('FormulaClock.state.layout.ast'), ast);
  await page.screenshot({ path: String(path.join(args.outputDir, 'saved-formula.png')) });
  await page.evaluate('FormulaClock.setDisplay({font:"termes",division:"slash"})');
  await page.waitForFunction(
    'FormulaClock.state.layout.display.font==="termes" && !document.querySelector("#share").disabled',
    undefined,
    { timeout: 45000 },
  );
  assert.deepEqual(page.url(), args.url);
  assert.deepEqual(await page.title(), 'Formula Clock');
  assert.ok(await page.evaluate('sameDocument && history.length===initialHistoryLength'));
  assert.deepEqual(await page.evaluate<Expr | null>('FormulaClock.state.layout.ast'), ast);
  await page.click('#share');
  await page.waitForFunction(
    'nativeCalls.length===2 || document.querySelector("#share-dialog").open',
    undefined,
  );
  if (await page.locator('#share-dialog').isVisible()) {
    await page.click('#share-native');
    await page.keyboard.press('Escape');
  }
  const restyled = await page.evaluate<string>('nativeCalls.at(-1).url');
  assert.notDeepEqual(restyled, url);
  assert.deepEqual(await readSnapshot(ctx, restyled), {
    ...snapshot,
    font: 'termes',
    division: 'slash',
  });
  await page.keyboard.press('ArrowRight');
  await ready(page, '123422');
  assert.ok(await page.evaluate('FormulaClock.state.paused'));
  await page.keyboard.press('ArrowLeft');
  await ready(page, '123421');
  assert.ok(
    await page.evaluate(
      script(
        'async()=>JSON.stringify(FormulaClock.state.layout.ast)===JSON.stringify((await FORMULA_CLOCK_CONFIG.provider.getMinute("1234")).seconds[21])',
      ),
    ),
  );
  assert.notDeepEqual(await page.evaluate<Expr | null>('FormulaClock.state.layout.ast'), ast);
  assert.ok(await page.evaluate('FormulaClock.digits.every((digit,i)=>digit===originalDigits[i])'));
  report['checks'].push(
    'Saved AST overrides updated data and survives resize/restyling; resharing reuses unchanged ids; history is replaced without reload',
  );
  // Null must remain a saved ordinary clock even where the dataset has a formula.
  const nullSnapshot = { ...snapshot, t: '123430', ast: null };
  const nullId = shareId(
    await (await ctx.request.post(args.url + 'api/shares', { data: nullSnapshot })).json(),
  );
  assert.deepEqual(await readSnapshot(ctx, args.url + 's/' + nullId), nullSnapshot);
  await page.goto(args.url + 's/' + nullId, { waitUntil: 'domcontentloaded' });
  await ready(page, '123430');
  assert.deepEqual(await page.evaluate('FormulaClock.state.layout.mode'), 'time');
  assert.deepEqual(await page.title(), 'Formula Clock — 12:34:30');
  await page.click('#share');
  assert.deepEqual(await page.evaluate('nativeCalls.at(-1).title'), 'Formula Clock - 12:34:30');
  assert.ok(await page.evaluate('!("text" in nativeCalls.at(-1))'));
  assert.ok(
    await page.evaluate(
      script('async()=>!!(await FORMULA_CLOCK_CONFIG.provider.getMinute("1234")).seconds[30]'),
    ),
  );
  await page.evaluate('FormulaClock.preview(FormulaShare.localDate("123430"),true)');
  await ready(page, '123430');
  await page.waitForFunction('FormulaClock.state.layout.mode === "formula"', undefined);
  assert.deepEqual(page.url(), args.url);
  assert.deepEqual(await page.evaluate('FormulaClock.state.layout.mode'), 'formula');
  report['checks'].push(
    'An explicit null snapshot stays an ordinary clock until a time operation resumes current data',
  );
  // A saved view remains renderable and shareable even when the current data fails.
  const failedCtx = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
  await failedCtx.addInitScript(
    "const originalFetch=fetch;window.fetch=(input,...args)=>String(input?.url||input).includes('data/')?Promise.reject(new Error('Dataset offline')):originalFetch(input,...args);",
  );
  const failedPage = await failedCtx.newPage();
  await failedPage.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(failedPage, '123421');
  assert.deepEqual(await failedPage.evaluate<Expr | null>('FormulaClock.state.layout.ast'), ast);
  assert.deepEqual(await failedPage.evaluate('new Date(FormulaClock.state.now).getHours()'), 12);
  assert.deepEqual(await failedPage.locator('#state-label').innerText(), '');
  await failedPage.click('#go-live');
  assert.ok(
    failedPage.url() === args.url && !(await failedPage.evaluate('FormulaClock.state.preview')),
  );
  await failedCtx.close();
  report['checks'].push(
    'Saved formula loads with the current dataset offline and preserves wall-clock time across timezones',
  );
  // The network can outlast transient activation: offer a fresh native click.
  await page.evaluate(
    'window.nativeCalls=[];window.shareMode="slow";FormulaClock.preview(FormulaShare.localDate("123431"),true)',
  );
  await ready(page, '123431');
  await page.click('#share');
  assert.ok(
    await page.evaluate('FormulaClock.state.paused && document.querySelector("#share").disabled'),
  );
  assert.deepEqual(await page.locator('#share-status').textContent(), '');
  await page.waitForFunction('document.querySelector("#share-dialog").open', undefined, {
    timeout: 15000,
  });
  assert.deepEqual(await page.evaluate<number>('nativeCalls.length'), 0);
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width: width, height: 844 });
    assert.ok(
      await page.locator('#share-dialog').evaluate(script('el=>el.scrollWidth<=el.clientWidth')),
    );
    assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await page.screenshot({
      path: String(path.join(args.outputDir, `delayed-share-${width}.png`)),
    });
  }
  await page.click('#share-native');
  assert.ok(await page.evaluate('nativeCalls.at(-1).activation'));
  const delayedUrl = await page.evaluate<string>('nativeCalls.at(-1).url');
  assert.ok(new RegExp('/s/[A-Za-z0-9]{10}$').exec(delayedUrl)!);
  assert.deepEqual(await readSnapshot(ctx, delayedUrl), await page.evaluate('postBodies.at(-1)'));
  await page.keyboard.press('Escape');
  report['checks'].push(
    'A slow ID request stays silent, preserves the displayed AST and offers native sharing with fresh user activation at 320/390/768 px',
  );
  await page.evaluate(
    'window.shareMode="fail";FormulaClock.preview(FormulaShare.localDate("123432"),true)',
  );
  await ready(page, '123432');
  await page.click('#share');
  await page.waitForFunction(
    'document.querySelector("#share-status").textContent.includes("作成できません") && !document.querySelector("#share").disabled',
    undefined,
  );
  assert.ok(
    await page.evaluate(
      'FormulaClock.state.paused && !document.querySelector("#share-dialog").open',
    ),
  );
  for (const width of [320, 390]) {
    await page.setViewportSize({ width: width, height: 844 });
    assert.ok(
      await page
        .locator('#share-status')
        .evaluate(
          script(
            'el=>el.getBoundingClientRect().left>=0 && el.getBoundingClientRect().right<=innerWidth',
          ),
        ),
    );
  }
  await page.evaluate(
    'window.shareMode="normal";Object.defineProperty(navigator,"share",{configurable:true,value:undefined})',
  );
  await page.click('#share');
  await page.waitForFunction('copies.length', undefined);
  assert.deepEqual(
    await readSnapshot(ctx, await page.evaluate<string>('copies.at(-1)')),
    await page.evaluate('postBodies.at(-1)'),
  );
  await page.evaluate(
    'window.shareMode="slow";FormulaClock.preview(FormulaShare.localDate("123433"),true)',
  );
  await ready(page, '123433');
  await page.click('#share');
  await page.click('#go-live');
  await page.waitForTimeout(6500);
  assert.ok(!(await page.evaluate('FormulaClock.state.preview')));
  assert.ok(await page.locator('#share-dialog').isHidden());
  assert.deepEqual(await page.evaluate<number>('copies.length'), 1);
  assert.deepEqual(await page.locator('#share-status').innerText(), '');
  report['checks'].push(
    'ID request errors enable retry; leaving the view cancels pending shares without stale copies or dialogs',
  );
  const titleAst: Expr = {
    op: 'add',
    a: { op: 'lit', i: 0, j: 1 },
    b: {
      op: 'div',
      a: { op: 'pow', a: { op: 'lit', i: 1, j: 2 }, b: { op: 'lit', i: 2, j: 3 } },
      b: { op: 'sqrt', a: { op: 'lit', i: 3, j: 4 } },
    },
  };
  const titleId = shareId(
    await (
      await ctx.request.post(args.url + 'api/shares', {
        data: { ...snapshot, t: '123405', ast: titleAst },
      })
    ).json(),
  );
  assert.deepEqual((await readSnapshot(ctx, args.url + 's/' + titleId))['ast'], titleAst);
  await page.goto(args.url + 's/' + titleId, { waitUntil: 'domcontentloaded' });
  await ready(page, '123405');
  assert.deepEqual(await page.title(), '1 + 2^3 / √4 = 5');
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    assert.deepEqual(
      await page.locator(selector).getAttribute('content'),
      'Formula Clock - 12:34:05',
    );
  }
  for (const selector of [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  ]) {
    assert.deepEqual(await page.locator(selector).getAttribute('content'), '1+2^3/√4=5');
  }
  await page.click('#share');
  assert.deepEqual(await page.evaluate('nativeCalls.at(-1).title'), 'Formula Clock - 12:34:05');
  assert.ok(await page.evaluate('!("text" in nativeCalls.at(-1))'));
  assert.deepEqual(
    await page.evaluate<string>('nativeCalls.at(-1).url'),
    args.url + 's/' + titleId,
  );
  report['checks'].push(
    'Native sharing passes the card title and saved URL without text; OG/Twitter descriptions keep the compact equation',
  );
  report['mathjax'] = await page.evaluate('FormulaClock.diagnostics().mathjax');
  assert.deepEqual(report['mathjax'], '4.1.3');
  await ctx.close();
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
