import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import type { Page } from '@playwright/test';
import { test, createReport, playwrightVersion } from '../helpers/browser.ts';

declare global {
  // Suite-local names: audio.test.ts declares richer voice/gain shapes for its
  // page; this page's instrument records leaner objects.
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
  // Retain native Web Audio nodes but hold restored resume requests to model a
  // browser requiring interaction. Both pending and rejected resumes are tested.
  const instrument = () => {
    window.settingsGains = [];
    window.settingsVoices = [];
    window.audioResumeCalls = 0;
    try {
      window.holdAudioResume =
        JSON.parse(localStorage.getItem('formula-clock-audio-v1') || '{}')?.enabled === true;
    } catch {
      window.holdAudioResume = false;
    }
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
  async function newPage(
    prefix?: (page: Page) => Promise<unknown>,
    suffix?: (page: Page) => Promise<unknown>,
  ) {
    const page = await browser.newPage({
      locale: 'ja-JP',
      viewport: { width: 1440, height: 1000 },
      timezoneId: 'Asia/Tokyo',
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    if (prefix) await prefix(page);
    await page.addInitScript(instrument);
    if (suffix) await suffix(page);
    await page.goto(args.url);
    await ready(page);
    return page;
  }
  async function ready(page: Page) {
    await page.waitForFunction(
      () => window.FormulaClock?.state.engineReady && FormulaClock.state.layout,
      undefined,
      { timeout: 35000 },
    );
    // Keep all scheduled clock tones silent so only explicit enable feedback
    // can contribute an oscillator during these persistence checks.
    await page.evaluate(() => FormulaClock.preview('2026-09-09T12:34:08+09:00', true));
  }
  async function settings(page: Page, enabled: boolean, volume: number, persisted = true) {
    assert.deepEqual(await page.evaluate(() => FormulaClock.state.soundEnabled), enabled);
    assert.deepEqual(
      await page.locator('#sound').getAttribute('aria-pressed'),
      String(enabled).toLowerCase(),
    );
    assert.ok(
      Math.abs((await page.evaluate(() => FormulaClock.state.soundVolume)) - volume) < 1e-9,
    );
    assert.ok(Math.abs(Number(await page.locator('#volume').inputValue()) - volume * 100) < 1e-9);
    if (persisted) {
      assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key), {
        enabled: enabled,
        volume: volume,
      });
    }
  }
  async function volume(page: Page, percent: number) {
    await page.click('#settings-open');
    await page.locator('#volume').evaluate((el: HTMLInputElement, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(percent));
    await page.keyboard.press('Escape');
  }
  let page = await newPage();
  report['mathjax'] = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
  assert.deepEqual(report['mathjax'], '4.1.3');
  await settings(page, false, 0.25, false);
  assert.ok(await page.evaluate(() => !window.audioContext));
  const displayBefore = await page.evaluate(() => localStorage.getItem('formula-clock-display-v2'));
  await volume(page, 40);
  await settings(page, false, 0.4);
  assert.deepEqual(
    await page.evaluate(() => localStorage.getItem('formula-clock-display-v2')),
    displayBefore,
  );
  await page.reload();
  await ready(page);
  await settings(page, false, 0.4);
  await page.click('#sound');
  await page.waitForFunction(() => FormulaClock.state.soundReady, undefined);
  await settings(page, true, 0.4);
  assert.deepEqual((await page.evaluate(() => settingsVoices)).length, 1);
  assert.ok(Math.abs((await page.evaluate(() => settingsGains[0].gain.value)) - 0.128) < 1e-7);
  report['checks'].push(
    'Fresh defaults remain off/25%; changing volume while off persists; reload preserves off/40%; enabling persists on and applies the restored volume to the native master gain',
  );
  await page.reload();
  await ready(page);
  await settings(page, true, 0.4);
  assert.ok(!(await page.evaluate(() => FormulaClock.state.soundReady)));
  assert.ok(
    (await page.locator('#sound').getAttribute('aria-label'))!.includes('画面を操作すると再開'),
  );
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => settingsVoices.length), 0);
  let resumes = await page.evaluate(() => audioResumeCalls);
  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })),
  );
  assert.deepEqual(await page.evaluate(() => audioResumeCalls), resumes);
  await page.evaluate(() => (window.holdAudioResume = false));
  await page.click('#settings-open');
  await page.waitForFunction(() => FormulaClock.state.soundReady, undefined);
  assert.ok((await page.evaluate(() => audioResumeCalls)) >= 2);
  assert.deepEqual(await page.evaluate(() => settingsVoices.length), 0);
  assert.ok(Math.abs((await page.evaluate(() => settingsGains[0].gain.value)) - 0.128) < 1e-7);
  await page.keyboard.press('Escape');
  report['checks'].push(
    'A pending restored resume keeps the on preference and button state; the first click resumes native audio at the saved gain, without an enable-feedback tone',
  );
  await volume(page, 0);
  await settings(page, true, 0);
  await page.reload();
  await ready(page);
  await settings(page, true, 0);
  resumes = await page.evaluate(() => audioResumeCalls);
  await page.click('#sound');
  await settings(page, false, 0);
  assert.deepEqual(await page.evaluate(() => audioResumeCalls), resumes);
  await page.evaluate(() => audioContext.forceResume());
  await page.waitForTimeout(180);
  await settings(page, false, 0);
  assert.ok(!(await page.evaluate(() => FormulaClock.state.soundReady)));
  assert.deepEqual(await page.evaluate(() => settingsVoices.length), 0);
  await page.reload();
  await ready(page);
  await settings(page, false, 0);
  await page.keyboard.press('m');
  await page.waitForFunction(() => FormulaClock.state.soundReady, undefined);
  await settings(page, true, 0);
  await page.keyboard.press('m');
  await settings(page, false, 0);
  report['checks'].push(
    'Zero volume is preserved; muting a pending restore does not resume it or lose the saved off state when the old request finishes; keyboard M persists both states',
  );
  // Two enable attempts separated by off must not both play feedback when
  // their pending resumes finally resolve on the same later gesture.
  let baseline = await page.evaluate(() => settingsVoices.length);
  await page.evaluate(async () => {
    await audioContext.suspend();
    window.holdAudioResume = true;
  });
  await page.click('#sound');
  await settings(page, true, 0);
  resumes = await page.evaluate(() => audioResumeCalls);
  // WebKit on macOS does not focus buttons on a mouse click.
  await page.locator('#sound').focus();
  await page.keyboard.press('Space');
  await settings(page, false, 0);
  assert.deepEqual(await page.evaluate(() => audioResumeCalls), resumes);
  await page.click('#sound');
  await settings(page, true, 0);
  await page.evaluate(() => (window.holdAudioResume = false));
  await page.locator('#sound').focus();
  await page.keyboard.press('a');
  await page.waitForFunction(() => FormulaClock.state.soundReady, undefined);
  await page.waitForTimeout(180);
  assert.deepEqual(await page.evaluate(() => settingsVoices.length), baseline + 1);
  report['checks'].push(
    'Rapid on/off/on while resume is pending keeps the latest choice; Space on the sound button mutes without resuming; another key resumes even with the sound button focused, and only the latest enable attempt produces feedback',
  );
  await page.close();
  const cases = [
    ['{bad', false, 0.25] as const,
    ['{"enabled":"true","volume":"0.4"}', false, 0.25] as const,
    ['{"enabled":false,"volume":0}', false, 0] as const,
    ['{"enabled":false,"volume":1}', false, 1] as const,
    ['{"enabled":false,"volume":-1}', false, 0.25] as const,
    ['{"enabled":false,"volume":2}', false, 0.25] as const,
    ['{"enabled":true,"volume":null}', true, 0.25] as const,
  ];
  for (const [raw, enabled, level] of cases) {
    page = await newPage((page) =>
      page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key, raw }),
    );
    await settings(page, enabled, level, false);
    await page.close();
  }
  page = await newPage((page) =>
    page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('Storage unavailable');
      };
      Storage.prototype.setItem = () => {
        throw new Error('Storage unavailable');
      };
    }),
  );
  await settings(page, false, 0.25, false);
  await volume(page, 60);
  await page.click('#sound');
  await page.waitForFunction(() => FormulaClock.state.soundReady, undefined);
  await settings(page, true, 0.6, false);
  await page.close();
  report['checks'].push(
    'Malformed JSON, invalid types and out-of-range levels recover safely; valid 0%/100% survive; unavailable storage does not break volume, toggling or the clock',
  );
  // Some browsers reject rather than leave the promise pending. A rejected
  // resume must also keep the preference and allow a subsequent interaction.
  const rejection = () => {
    const resume = AudioContext.prototype.resume;
    let rejectOnce = true;
    AudioContext.prototype.resume = function () {
      if (rejectOnce) {
        rejectOnce = false;
        return Promise.reject(new DOMException('Interaction required', 'NotAllowedError'));
      }
      return resume.call(this);
    };
  };
  page = await browser.newPage({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
    key,
    raw: JSON.stringify({ enabled: true, volume: 0.4 }),
  });
  await page.addInitScript(instrument);
  await page.addInitScript(rejection);
  await page.goto(args.url);
  await ready(page);
  await settings(page, true, 0.4);
  assert.ok(!(await page.evaluate(() => FormulaClock.state.soundReady)));
  await page.evaluate(() => (window.holdAudioResume = false));
  await page.keyboard.press('a');
  await page.waitForFunction(() => FormulaClock.state.soundReady, undefined);
  await settings(page, true, 0.4);
  assert.deepEqual(await page.evaluate(() => settingsVoices.length), 0);
  await page.close();
  report['checks'].push(
    'A rejected autoplay resume retains on/volume, retries on a trusted key event and starts without restore feedback',
  );
  // Also exercise the browser's native startup policy without the test gate.
  page = await newPage(
    (page) =>
      page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
        key,
        raw: JSON.stringify({ enabled: true, volume: 0.35 }),
      }),
    (page) =>
      page.addInitScript(() => {
        window.holdAudioResume = false;
      }),
  );
  await settings(page, true, 0.35);
  report['nativeReadyBeforeInteraction'] = await page.evaluate(() => FormulaClock.state.soundReady);
  baseline = await page.evaluate(() => settingsVoices.length);
  if (!report['nativeReadyBeforeInteraction']) {
    await page.click('#settings-open');
    await page.waitForFunction(() => FormulaClock.state.soundReady, undefined);
  }
  assert.ok(Math.abs((await page.evaluate(() => settingsGains[0].gain.value)) - 0.112) < 1e-7);
  assert.deepEqual(await page.evaluate(() => settingsVoices.length), baseline);
  await page.close();
  report['checks'].push(
    'The native browser policy also restores the saved on/35% state, starts immediately when allowed or resumes on a click, and adds no restore feedback',
  );
  assert.ok(!(errors.length > 0), inspect(errors));
  report['pageErrors'] = errors;
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
