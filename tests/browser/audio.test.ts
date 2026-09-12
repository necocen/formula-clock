import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { test, createReport, playwrightVersion, sorted } from '../helpers/browser.ts';
interface AudioCommand {
  method:
    | 'setValueAtTime'
    | 'linearRampToValueAtTime'
    | 'exponentialRampToValueAtTime'
    | 'setTargetAtTime';
  args: number[];
}
interface Voice {
  when: number;
  frequency: number;
  type: string;
  stops: number[];
  commands: AudioCommand[];
}
interface RenderedVoice {
  frequency: number;
  audibleDuration: number;
  duration: number;
  quietBefore: boolean;
  quietAfter: boolean;
  peak: number;
  earlyRms: number;
  lateRms: number;
  wav?: string;
}
interface InstrumentedGain extends GainNode {
  commands: AudioCommand[];
  testParam: AudioParam;
}
interface TestVoice {
  when: number;
  frequency: number;
  type: OscillatorType;
  stops: number[];
  gain: InstrumentedGain;
}
declare global {
  var audioVoices: TestVoice[];
  var audioGains: InstrumentedGain[];
  var testAudioContext: AudioContext;
  var audioSnapshot: () => Voice[];
  var renderVoice: (index: number) => Promise<RenderedVoice>;
}
test.use({
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Asia/Tokyo',
});
test('audio', async ({ browser, args, page }) => {
  const report = createReport({
    at: new Date().toISOString(),
    command: process.argv,
    browser: args.browser,
    url: args.url,
    playwright: playwrightVersion,
    checks: [],
  });
  const errors: string[] = [];
  report['browserVersion'] = browser.version();
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    window.audioVoices = [];
    window.audioGains = [];
    const NativeAudio = window.AudioContext || window.webkitAudioContext!;
    window.AudioContext = class extends NativeAudio {
      constructor(...args: unknown[]) {
        super(...(args as [AudioContextOptions?]));
        window.testAudioContext = this;
      }
      createGain() {
        const node = super.createGain() as InstrumentedGain;
        node.commands = [];
        audioGains.push(node);
        // Keep the instrumented AudioParam wrapper alive between operations
        // (WebKit can otherwise recreate it and lose these JS-only hooks).
        const param = node.gain;
        node.testParam = param;
        for (const method of [
          'setValueAtTime',
          'linearRampToValueAtTime',
          'exponentialRampToValueAtTime',
          'setTargetAtTime',
        ] as const) {
          const original = (param[method] as (...values: number[]) => AudioParam).bind(param);
          param[method] = (...args: number[]) => {
            node.commands.push({ method, args });
            return original(...args);
          };
        }
        return node;
      }
      createOscillator() {
        const node = super.createOscillator(),
          voice = { stops: [] as number[] } as TestVoice;
        const connect = (node.connect as (destination: AudioNode) => AudioNode).bind(node),
          start = node.start.bind(node),
          stop = node.stop.bind(node) as (...args: number[]) => void;
        node.connect = ((destination: InstrumentedGain) => {
          voice.gain = destination;
          return connect(destination);
        }) as AudioNode['connect'];
        node.start = (when) => {
          Object.assign(voice, { when, frequency: node.frequency.value, type: node.type });
          audioVoices.push(voice);
          return start(when);
        };
        node.stop = (...args: number[]) => {
          voice.stops.push(args.length ? args[0] : this.currentTime);
          return stop(...args);
        };
        return node;
      }
    } as typeof AudioContext;
    window.audioSnapshot = () =>
      audioVoices.map((v) => ({
        when: v.when,
        frequency: v.frequency,
        type: v.type,
        stops: v.stops.slice(),
        commands: v.gain.commands,
      }));
    window.renderVoice = async (index: number) => {
      const voice = audioVoices[index],
        duration = voice.stops[0] - voice.when,
        rate = 48000,
        offset = 0.03;
      const ctx = new OfflineAudioContext(1, Math.ceil((duration + 0.06) * rate), rate);
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.value = voice.frequency;
      for (const { method, args } of voice.gain.commands) {
        const replay = args.slice();
        replay[1] = offset + replay[1] - voice.when;
        (gain.gain[method] as (...values: number[]) => AudioParam)(...replay);
      }
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(offset);
      osc.stop(offset + duration);
      const samples = (await ctx.startRendering()).getChannelData(0),
        crossings: number[] = [];
      let first = -1,
        last = -1,
        peak = 0;
      for (let i = 1; i < samples.length; i++) {
        const value = Math.abs(samples[i]);
        peak = Math.max(peak, value);
        if (value > 1e-7) {
          if (first < 0) first = i;
          last = i;
        }
        if (
          samples[i] > 0 &&
          samples[i - 1] <= 0 &&
          i > offset * rate + 1 &&
          i < (offset + duration) * rate - 1
        )
          crossings.push(i - samples[i] / (samples[i] - samples[i - 1]));
      }
      const frequency = (rate * (crossings.length - 1)) / (crossings.at(-1)! - crossings[0]);
      const rms = (a: number, b: number) => {
        const start = Math.ceil((offset + a) * rate),
          end = Math.floor((offset + b) * rate);
        let sum = 0;
        for (let i = start; i < end; i++) sum += samples[i] * samples[i];
        return Math.sqrt(sum / (end - start));
      };
      const wav = new ArrayBuffer(44 + samples.length * 2),
        view = new DataView(wav);
      const text = (pos: number, value: string) =>
        [...value].forEach((c, i) => view.setUint8(pos + i, c.charCodeAt(0)));
      text(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      text(8, 'WAVE');
      text(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      samples.forEach((value, i) => view.setInt16(44 + i * 2, Math.round(value * 32767), true));
      let bytes = '';
      for (const value of new Uint8Array(wav)) bytes += String.fromCharCode(value);
      return {
        duration,
        frequency,
        peak,
        audibleDuration: (last - first + 1) / rate,
        quietBefore: first >= Math.floor(offset * rate),
        quietAfter: last < Math.ceil((offset + duration) * rate),
        earlyRms: rms(duration * 0.15, duration * 0.3),
        lateRms: rms(duration * 0.8, duration * 0.95),
        wav: btoa(bytes),
      };
    };
  });
  // A fixed wall clock leaves Web Audio and browser timers running normally.
  async function wall(second: number, minute = 34, millis = 50) {
    await page.clock.setFixedTime(
      new Date(Date.UTC(2026, 9 - 1, 9, 3, minute, second, (millis * 1000) / 1000)),
    );
  }
  await wall(0, undefined, 500);
  await page.goto(args.url);
  await page.waitForFunction(
    () => window.FormulaClock?.state.engineReady && FormulaClock.state.layout,
    undefined,
  );
  report['mathjax'] = await page.evaluate(() => FormulaClock.diagnostics().mathjax);
  assert.deepEqual(report['mathjax'], '4.1.3');
  await page.click('#sound');
  await page.waitForFunction(() => FormulaClock.state.soundEnabled, undefined);
  // The short enable feedback is separate from clock signals.
  await page.waitForTimeout(200);
  const baseline = await page.evaluate(() => audioVoices.length);
  for (const second of Array.from({ length: 60 }, (_, i) => i)) {
    await wall(second);
    await page.waitForFunction((n) => audioVoices.length >= n, baseline + second + 1);
    await page.waitForTimeout(75);
    assert.deepEqual(
      await page.evaluate(() => audioVoices.length),
      baseline + second + 1,
      inspect(second),
    );
  }
  const voices = (await page.evaluate(() => audioSnapshot())).slice(baseline);
  const expected = (s: number) =>
    s % 10 === 0
      ? ([1000, 1.35] as const)
      : s % 30 >= 27
        ? ([500, 0.05] as const)
        : ([2000, 0.007] as const);
  for (const [second, voice] of voices.entries()) {
    const [frequency, duration] = expected(second);
    assert.ok(
      voice['type'] === 'sine' && voice['frequency'] === frequency,
      inspect([second, voice] as const),
    );
    assert.ok(
      Math.abs(voice['stops'][0] - voice['when'] - duration) < 1e-7,
      inspect([second, voice] as const),
    );
    const times = voice['commands'].map((command) => command['args'][1]);
    // A 7 ms pulse must not have an 8 ms attack.
    assert.deepEqual(times, sorted(times), inspect([second, voice] as const));
    assert.ok(
      Math.abs(times[0] - voice['when']) < 1e-7 &&
        Math.abs(times.at(-1)! - voice['stops'][0]) < 1e-7,
    );
  }
  report['minuteFrequencies'] = voices.map((v) => v['frequency']);
  report['checks'].push(
    'All 60 seconds produce exactly one native sine oscillator: 48 ticks, 6 countdowns and 6 ten-second markers, with 7/50/1350 ms durations',
  );
  const rendered: Record<string, unknown> = {};
  for (const [second, name] of [
    [1, 'tick'] as const,
    [27, 'countdown'] as const,
    [30, 'marker'] as const,
  ]) {
    const result = await page.evaluate((index) => renderVoice(index), baseline + second);
    const wav = (() => {
      const value = result['wav'];
      delete result['wav'];
      return value;
    })();
    fs.writeFileSync(path.join(args.outputDir, `${name}.wav`), Buffer.from(wav!, 'base64'));
    const [frequency, duration] = expected(second);
    assert.ok(Math.abs(result['frequency'] - frequency) < 1, inspect(result));
    assert.ok(Math.abs(result['audibleDuration'] - duration) < 0.0001, inspect(result));
    assert.ok(
      result['quietBefore'] && result['quietAfter'] && 0 < result['peak'] && result['peak'] <= 1,
      inspect(result),
    );
    if (name === 'marker') {
      assert.ok(result['lateRms'] < result['earlyRms'] * 0.02, inspect(result));
    } else {
      assert.ok(
        0.75 < result['lateRms'] / result['earlyRms'] &&
          result['lateRms'] / result['earlyRms'] < 1.25,
        inspect(result),
      );
    }
    rendered[name] = result;
  }
  report['renderedAudio'] = rendered;
  report['checks'].push(
    'OfflineAudioContext replay of the actual oscillator/gain commands confirms frequencies, audible durations, silent boundaries, short pulse sustain and decaying marker',
  );
  // A late timer never catches up on missed seconds.
  let before = await page.evaluate(() => audioVoices.length);
  await wall(5, 35, 500);
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before);
  await wall(6, 35);
  await page.waitForFunction((n) => audioVoices.length === n, before + 1);
  assert.deepEqual(await page.evaluate(() => audioVoices.at(-1)!.frequency), 2000);
  before = await page.evaluate(() => audioVoices.length);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  // The same second must not replay.
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before);
  // Hiding cancels audio; returning after a gap plays only the current second.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  before = await page.evaluate(() => audioVoices.length);
  await wall(8, 35);
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before);
  await wall(10, 35);
  await page.evaluate(() => {
    delete (document as { hidden?: boolean }).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction((n) => audioVoices.length === n, before + 1);
  assert.deepEqual(await page.evaluate(() => audioVoices.at(-1)!.frequency), 1000);
  await page.click('#sound');
  const cancelled = await page.evaluate(() => audioSnapshot().at(-1)!);
  assert.ok(
    cancelled['stops'].length === 2 && cancelled['stops'][1] < cancelled['stops'][0],
    inspect(cancelled),
  );
  before = await page.evaluate(() => audioVoices.length);
  await page.click('#sound');
  await page.waitForTimeout(200);
  // Enable feedback only, no duplicate marker.
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before + 1);
  await page.click('#sound');
  before = await page.evaluate(() => audioVoices.length);
  await wall(11, 35);
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before);
  await page.evaluate(() => FormulaClock.preview('2026-09-09T12:35:26.700+09:00', true));
  await page.click('#sound');
  await page.waitForTimeout(200);
  before = await page.evaluate(() => audioVoices.length);
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before);
  await page.click('#settings-open');
  await page.locator('#volume').evaluate((el: HTMLInputElement) => {
    el.value = '40';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const volume = await page.evaluate(() => ({
    value: audioGains[0].gain.value,
    commands: audioGains[0].commands,
    input: document.querySelector<HTMLInputElement>('#volume')!.value,
  }));
  // AudioParam.value can retain the intrinsic value while automation runs.
  // Verify that the slider schedules the real master node's smooth gain change.
  assert.ok(
    volume['commands'].at(-1)!['method'] === 'setTargetAtTime' &&
      Math.abs(volume['commands'].at(-1)!['args'][0] - 0.128) < 1e-7,
    inspect(volume),
  );
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  assert.ok(
    await page.evaluate(
      () => FormulaClock.state.paused && new Date(FormulaClock.state.now).getSeconds() === 27,
    ),
  );
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before);
  await wall(29, 35);
  await page.click('#go-live');
  await page.waitForFunction((n) => audioVoices.length === n + 1, before);
  assert.deepEqual(await page.evaluate(() => audioVoices.at(-1)!.frequency), 500);
  await wall(30, 35);
  await page.waitForFunction((n) => audioVoices.length === n + 2, before);
  assert.deepEqual(await page.evaluate(() => audioVoices.at(-1)!.frequency), 1000);
  await page.evaluate(() => FormulaClock.pause());
  before = await page.evaluate(() => audioVoices.length);
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => audioVoices.length), before);
  report['checks'].push(
    'Missed seconds are skipped; visibility/off cancels audio; volume updates the master gain; paused previews and arrow-key steps are silent; returning to current time resumes the correct signal',
  );
  await page.click('#sound');
  assert.ok(!(errors.length > 0), inspect(errors));
  report['pageErrors'] = errors;
  fs.writeFileSync(
    path.join(args.outputDir, 'results.json'),
    JSON.stringify(report, null, 2) +
      `
`,
  );
});
