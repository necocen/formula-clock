import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import type { Page } from '@playwright/test';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';

declare global {
  // Suite-local names: audio.test.ts records richer voice/gain shapes.
  var settingsGains: GainNode[];
  var settingsVoices: { frequency: number; when: number }[];
  var audioResumeCalls: number;
  var holdAudioResume: boolean;
  var webkitAudioContext: typeof AudioContext;
  var audioContext: AudioContext & {
    waiters: { resolve: () => void; reject: (reason?: unknown) => void }[];
    finishResume(): Promise<void>;
    forceResume(): Promise<void>;
  };
}

test('audio-settings', async ({ browser, args }) => {
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    playwright: playwrightVersion,
    url: args.url,
    checks: [],
  });
  const errors: string[] = [];
  const key = 'formula-clock-audio-v1';
  // Keep native Web Audio nodes. A controllable gate exercises cancellation
  // and stale resume responses independently of each browser's autoplay policy.
  const instrument = () => {
    window.settingsGains = [];
    window.settingsVoices = [];
    window.audioResumeCalls = 0;
    window.holdAudioResume = false;
    const NativeAudio = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = class extends NativeAudio {
      declare waiters: { resolve: () => void; reject: (reason?: unknown) => void }[];
      constructor(...args: [AudioContextOptions?]) {
        super(...args);
        window.audioContext = this;
        this.waiters = [];
        if (holdAudioResume) super.suspend();
      }
      get state() {
        return holdAudioResume ? 'suspended' : super.state;
      }
      createGain() {
        const gain = super.createGain();
        settingsGains.push(gain);
        return gain;
      }
      createOscillator() {
        const osc = super.createOscillator(),
          start = osc.start.bind(osc);
        osc.start = (...args) => {
          settingsVoices.push({ frequency: osc.frequency.value, when: args[0]! });
          return start(...args);
        };
        return osc;
      }
      resume() {
        audioResumeCalls++;
        if (holdAudioResume)
          return new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
        return this.finishResume();
      }
      finishResume() {
        return super.resume().then(() => {
          this.waiters.splice(0).forEach((w) => w.resolve());
        });
      }
      forceResume() {
        window.holdAudioResume = false;
        return this.finishResume();
      }
    };
  };
  report['browserVersion'] = browser.version();
  async function open(page: Page) {
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(instrument);
    await page.goto(args.url);
    await ready(page);
    return page;
  }
  async function newPage(raw?: string, locale = 'ja-JP') {
    const context = await browser.newContext({
      locale,
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'Asia/Tokyo',
      storageState: {
        cookies: [],
        origins:
          raw === undefined
            ? []
            : [
                {
                  origin: new URL(args.url).origin,
                  localStorage: [{ name: key, value: raw }],
                },
              ],
      },
    });
    return open(await context.newPage());
  }
  async function ready(page: Page) {
    await page.waitForFunction(
      () => window.FormulaClock?.state.engineReady && FormulaClock.state.layout,
      undefined,
      { timeout: 35000 },
    );
    // Pause clock tones so only an explicit successful start creates feedback.
    await page.evaluate(() => FormulaClock.preview('2026-09-09T12:34:08+09:00', true));
  }
  async function settings(page: Page, enabled: boolean, volume: number, ready = enabled) {
    assert.deepEqual(await page.evaluate(() => FormulaClock.state.soundEnabled), enabled);
    assert.deepEqual(await page.evaluate(() => FormulaClock.state.soundReady), ready);
    assert.deepEqual(await page.locator('#sound').getAttribute('aria-pressed'), String(ready));
    assert.ok(
      Math.abs((await page.evaluate(() => FormulaClock.state.soundVolume)) - volume) < 1e-9,
    );
    assert.ok(Math.abs(Number(await page.locator('#volume').inputValue()) - volume * 100) < 1e-9);
  }
  async function stored(page: Page) {
    return page.evaluate((key) => localStorage.getItem(key), key);
  }
  async function volume(page: Page, percent: number) {
    await page.click('#settings-open');
    await page.locator('#volume').evaluate((el: HTMLInputElement, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(percent));
    await page.keyboard.press('Escape');
  }
  async function unrelatedInteractions(page: Page) {
    const resumes = await page.evaluate(() => audioResumeCalls);
    await page.click('#settings-open');
    await page.keyboard.press('Escape');
    await page.click('#stage');
    await page.keyboard.press('a');
    assert.deepEqual(await page.evaluate(() => audioResumeCalls), resumes);
  }

  let page = await newPage();
  report['mathjax'] = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
  report['display'] = await page.evaluate(() => FormulaClock.state.display);
  assert.deepEqual(report['mathjax'], '4.1.3');
  await settings(page, false, 0.25);
  assert.equal(await stored(page), null);
  assert.ok(await page.evaluate(() => !window.audioContext));
  const mutedIcon = await page.locator('#sound-waves').getAttribute('d');
  const displayBefore = await page.evaluate(() => localStorage.getItem('formula-clock-display-v2'));
  await volume(page, 40);
  assert.deepEqual(JSON.parse((await stored(page))!), { volume: 0.4 });
  assert.deepEqual(
    await page.evaluate(() => localStorage.getItem('formula-clock-display-v2')),
    displayBefore,
  );
  await page.click('#sound');
  await page.waitForFunction(() => FormulaClock.state.soundReady);
  await settings(page, true, 0.4);
  assert.equal(await page.evaluate(() => settingsVoices.length), 1);
  assert.ok(Math.abs((await page.evaluate(() => settingsGains[0].gain.value)) - 0.128) < 1e-7);
  assert.deepEqual(JSON.parse((await stored(page))!), { volume: 0.4 });
  await page.locator('.tools').screenshot({ path: path.join(args.outputDir, 'sound-on.png') });
  const reopened = await open(await page.context().newPage());
  await settings(reopened, false, 0.4);
  assert.ok(await reopened.evaluate(() => !window.audioContext));
  await reopened.close();
  assert.equal(await page.evaluate(() => FormulaClock.state.soundEnabled), true);
  await page.reload();
  await ready(page);
  await settings(page, false, 0.4);
  await unrelatedInteractions(page);
  assert.ok(await page.evaluate(() => !window.audioContext));
  assert.equal(await page.evaluate(() => settingsVoices.length), 0);
  assert.equal(await page.locator('#sound-waves').getAttribute('d'), mutedIcon);
  await page.locator('.tools').screenshot({ path: path.join(args.outputDir, 'sound-off.png') });
  report['checks'].push(
    'Only volume is saved; turning sound on does not write an enabled preference; a new page sharing the same storage and a reload both start off without creating an AudioContext; unrelated clicks and keys stay silent',
  );

  await volume(page, 0);
  await page.click('#stage');
  await page.keyboard.press('m');
  await page.waitForFunction(() => FormulaClock.state.soundReady);
  await settings(page, true, 0);
  await page.keyboard.press('m');
  await settings(page, false, 0);
  assert.deepEqual(JSON.parse((await stored(page))!), { volume: 0 });
  await page.reload();
  await ready(page);
  await settings(page, false, 0);
  report['checks'].push(
    'M switches sound on and off within the page; 0% volume survives reload while sound returns to off',
  );

  await page.evaluate(() => {
    window.holdAudioResume = true;
  });
  await page.click('#sound');
  await settings(page, true, 0, false);
  assert.equal(await page.locator('#sound').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#sound').getAttribute('aria-label'), '時報の開始を取り消す');
  await page
    .locator('.tools')
    .screenshot({ path: path.join(args.outputDir, 'sound-starting.png') });
  await unrelatedInteractions(page);
  assert.equal(await page.evaluate(() => settingsVoices.length), 0);
  await page.locator('#sound').focus();
  await page.keyboard.press('Space');
  await settings(page, false, 0);
  assert.equal(await page.locator('#sound').getAttribute('aria-busy'), 'false');
  await page.evaluate(() => audioContext.forceResume());
  await page.waitForTimeout(180);
  await settings(page, false, 0);
  assert.equal(await page.evaluate(() => settingsVoices.length), 0);

  // Only the last of overlapping start requests may produce feedback.
  await page.evaluate(async () => {
    await audioContext.suspend();
    window.holdAudioResume = true;
  });
  await page.click('#sound');
  await page.click('#sound');
  await page.click('#sound');
  await settings(page, true, 0, false);
  await page.evaluate(() => audioContext.waiters.shift()!.reject(new Error('Stale failure')));
  await settings(page, true, 0, false);
  assert.equal(await page.locator('#share-status').innerText(), '');
  await page.evaluate(() => audioContext.forceResume());
  await page.waitForFunction(() => FormulaClock.state.soundReady);
  await settings(page, true, 0);
  assert.equal(await page.evaluate(() => settingsVoices.length), 1);
  report['checks'].push(
    'Pending starts use a cancellable busy icon without on styling; unrelated gestures do not retry; cancelling suppresses late feedback; on/off/on ignores the stale rejection and confirms only the latest start',
  );

  await page.evaluate(() => audioContext.suspend());
  await page.waitForFunction(() => !FormulaClock.state.soundReady);
  await settings(page, true, 0, false);
  assert.equal(await page.locator('#sound').getAttribute('aria-label'), '時報を再開する');
  await unrelatedInteractions(page);
  await page.click('#sound');
  await page.waitForFunction(() => FormulaClock.state.soundReady);
  assert.equal(await page.evaluate(() => settingsVoices.length), 2);
  report['checks'].push(
    'A suspended context is shown as stopped and can be resumed explicitly with the sound button',
  );
  await page.context().close();

  const cases = [
    ['{bad', 0.25],
    ['null', 0.25],
    ['[]', 0.25],
    ['{"enabled":"true","volume":"0.4"}', 0.25],
    ['{"enabled":true,"volume":0}', 0],
    ['{"volume":1}', 1],
    ['{"volume":-1}', 0.25],
    ['{"volume":2}', 0.25],
    ['{"enabled":true,"volume":null}', 0.25],
    ['{"enabled":true,"volume":0.35}', 0.35],
  ] as const;
  for (const [raw, level] of cases) {
    page = await newPage(raw);
    await settings(page, false, level);
    assert.ok(await page.evaluate(() => !window.audioContext));
    assert.equal(await stored(page), raw);
    await page.context().close();
  }
  page = await newPage('{"enabled":true,"volume":0.35}');
  const legacy = await stored(page);
  await page.click('#sound');
  await page.waitForFunction(() => FormulaClock.state.soundReady);
  await page.click('#sound');
  assert.equal(await stored(page), legacy);
  await volume(page, 65);
  assert.deepEqual(JSON.parse((await stored(page))!), { volume: 0.65 });
  await page.context().close();
  report['checks'].push(
    'Legacy enabled values are ignored without changing storage on load or toggle; valid volume is retained, malformed values recover safely, and volume changes write only volume',
  );

  page = await browser.newPage();
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage unavailable');
    };
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await open(page);
  await settings(page, false, 0.25);
  await volume(page, 60);
  await page.click('#sound');
  await page.waitForFunction(() => FormulaClock.state.soundReady);
  await settings(page, true, 0.6);
  await page.context().close();
  report['checks'].push(
    'Unavailable storage does not break the clock, volume, or explicit sound playback',
  );

  for (const locale of ['ja-JP', 'en-US']) {
    page = await newPage(undefined, locale);
    await page.evaluate(() => {
      const resume = AudioContext.prototype.resume;
      let rejectOnce = true;
      AudioContext.prototype.resume = function () {
        if (rejectOnce) {
          rejectOnce = false;
          return Promise.reject(new DOMException('Audio unavailable', 'NotAllowedError'));
        }
        return resume.call(this);
      };
    });
    await page.click('#sound');
    await page.waitForFunction(() => !FormulaClock.state.soundEnabled);
    await settings(page, false, 0.25);
    assert.equal(await page.locator('#sound').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#sound-waves').getAttribute('d'), mutedIcon);
    assert.equal(
      await page.locator('#sound').getAttribute('aria-label'),
      locale === 'ja-JP' ? '時報をオンにする' : 'Turn time signals on',
    );
    assert.equal(
      await page.locator('#share-status').innerText(),
      locale === 'ja-JP' ? '時報を再生できませんでした' : 'Could not play time signals',
    );
    assert.equal(await page.evaluate(() => settingsVoices.length), 0);
    await unrelatedInteractions(page);
    await settings(page, false, 0.25);
    await page.click('#sound');
    await page.waitForFunction(() => FormulaClock.state.soundReady);
    await settings(page, true, 0.25);
    assert.equal(await page.evaluate(() => settingsVoices.length), 1);
    assert.equal(await stored(page), null);
    await page.context().close();
  }
  report['checks'].push(
    'A rejected start returns to off with a localized notice; the same button retries successfully with one confirmation tone and no storage writes',
  );

  assert.ok(!errors.length, inspect(errors));
  report['pageErrors'] = errors;
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
});
