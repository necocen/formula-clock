import { isRecord } from '../shared/types.ts';
import type { AudioEvent } from './types.ts';
import { $ } from './dom.ts';
import type { Translate } from './types.ts';

export interface TimeSignalDeps {
  t: Translate;
  notify(text: string): void;
  getNow(): Date;
  isPaused(): boolean;
  generation(): number;
}

// Audio is scheduled independently of layout. There is no replay of missed signals.
class TimeSignal {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  enabled = false;
  volume: number;
  revision = 0;
  private starting = false;
  scheduled = new Map<string, number>();
  voices = new Set<OscillatorNode>();
  private events: AudioEvent[] = [];
  constructor(private deps: TimeSignalDeps) {
    let saved: Record<string, unknown> = {};
    try {
      const raw: unknown = JSON.parse(localStorage.getItem('formula-clock-audio-v1') || '{}');
      saved = isRecord(raw) ? raw : {};
    } catch {}
    this.ctx = null;
    this.master = null;
    // Sound is opt-in for this page. Older saved on/off values are ignored.
    this.volume =
      typeof saved.volume === 'number' &&
      Number.isFinite(saved.volume) &&
      saved.volume >= 0 &&
      saved.volume <= 1
        ? saved.volume
        : 0.25;
    this.revision = 0;
    this.scheduled = new Map();
    this.voices = new Set();
  }
  get ready() {
    return this.enabled && !this.starting && this.ctx?.state === 'running';
  }
  history(): AudioEvent[] {
    return this.events.slice();
  }
  private saveVolume() {
    try {
      localStorage.setItem('formula-clock-audio-v1', JSON.stringify({ volume: this.volume }));
    } catch {}
  }
  async toggle() {
    const revision = ++this.revision;
    if (this.enabled && (this.ready || this.starting)) {
      this.enabled = false;
      this.starting = false;
      this.cancel();
      this.paint();
      return;
    }
    this.enabled = true;
    this.starting = true;
    this.paint();
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('Web Audio API is unavailable');
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new Audio();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume * 0.32;
        this.master.connect(this.ctx.destination);
        this.ctx.addEventListener('statechange', () => {
          if (this.ctx?.state !== 'running') this.cancel();
          this.paint();
        });
      }
      // Resume is requested only by the sound button or its shortcut.
      // The same control can cancel an outstanding request.
      await this.ctx.resume();
      if (!this.enabled || revision !== this.revision) return;
      this.starting = false;
      this.paint();
      if (this.ready) this.tone(1000, this.ctx.currentTime + 0.02, 0.15, 0.28);
    } catch {
      if (!this.enabled || revision !== this.revision) return;
      this.enabled = false;
      this.starting = false;
      this.cancel();
      this.paint();
      this.deps.notify(this.deps.t('soundFailed'));
    }
  }
  paint() {
    const label = this.deps.t(
      !this.enabled
        ? 'soundOff'
        : this.starting
          ? 'soundStarting'
          : this.ready
            ? 'soundOn'
            : 'soundPaused',
    );
    $<HTMLButtonElement>('#sound').setAttribute('aria-pressed', String(this.ready));
    $<HTMLButtonElement>('#sound').setAttribute('aria-busy', String(this.starting));
    $<HTMLButtonElement>('#sound').setAttribute('aria-label', label);
    $<HTMLButtonElement>('#sound').title = this.deps.t('shortcut', { label, key: 'M' });
    $<SVGPathElement>('#sound-waves').setAttribute(
      'd',
      this.starting
        ? 'M16 8a4 4 0 1 1-4 4'
        : this.ready
          ? 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'
          : this.enabled
            ? 'M16 8v8m5-8v8'
            : 'm16 9 6 6m0-6-6 6',
    );
  }
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.saveVolume();
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.volume * 0.32, this.ctx.currentTime, 0.035);
  }
  tone(frequency: number, when: number, duration: number, strength = 1) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const oscillator = this.ctx.createOscillator(),
      gain = this.ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    // Short ticks need a nearly rectangular pulse; the longer signal has a
    // brief steady onset followed by a ringing decay. Both end at duration.
    const attack = Math.min(0.004, duration * 0.1);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(strength, when + attack);
    if (duration > 0.1) {
      gain.gain.setValueAtTime(strength, when + 0.08);
      gain.gain.exponentialRampToValueAtTime(strength * 0.001, when + duration - 0.004);
    } else gain.gain.setValueAtTime(strength, when + duration - attack);
    gain.gain.linearRampToValueAtTime(0, when + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.voices.add(oscillator);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.voices.delete(oscillator);
    };
    oscillator.start(when);
    oscillator.stop(when + duration);
  }
  cancel() {
    // A briefly hidden/muted page must not repeat a tone that already began.
    // Cancelled future tones may be scheduled again; transport changes use a
    // new generation, so seeking or restarting a preview still works.
    const now = this.ctx?.currentTime || 0;
    for (const [key, when] of this.scheduled) if (when > now) this.scheduled.delete(key);
    for (const oscillator of this.voices) {
      try {
        oscillator.stop();
      } catch {}
    }
    this.voices.clear();
  }
  poll() {
    if (!this.ready || !this.ctx || document.hidden || this.deps.isPaused()) return;
    const now = +this.deps.getNow(),
      second = Math.floor(now / 1000);
    for (const boundary of [second * 1000, (second + 1) * 1000]) {
      const delay = (boundary - now) / 1000;
      if (delay < -0.16 || delay > 0.16) continue;
      const date = new Date(boundary),
        sec = date.getSeconds();
      const countdown = sec % 30 >= 27,
        marker = sec % 10 === 0;
      // 117-style timing, with the marker extended 1.5x by listening preference.
      // These three categories never overlap at their onset.
      const frequency = marker ? 1000 : countdown ? 500 : 2000;
      const duration = marker ? 1.35 : countdown ? 0.05 : 0.007;
      const key = `${this.deps.generation()}:${boundary}`;
      if (this.scheduled.has(key)) continue;
      const when = this.ctx.currentTime + Math.max(0, delay);
      this.scheduled.set(key, when);
      while (this.scheduled.size > 20) this.scheduled.delete(this.scheduled.keys().next().value!);
      this.tone(frequency, when, duration, marker ? 1 : countdown ? 0.72 : 0.5);
      this.events.push({
        type: sec === 0 ? 'minute' : marker ? 'ten-second' : countdown ? 'countdown' : 'second',
        time: boundary,
        frequency,
        duration,
      });
      if (this.events.length > 30) this.events.shift();
    }
  }
}

export type Sound = TimeSignal;

export function createTimeSignal(deps: TimeSignalDeps): Sound {
  const sound = new TimeSignal(deps);
  $<HTMLInputElement>('#volume').value = String(sound.volume * 100);
  sound.paint();
  $<HTMLButtonElement>('#sound').addEventListener('click', () => sound.toggle());
  $<HTMLInputElement>('#volume').addEventListener('input', (e) =>
    sound.setVolume(Number((e.target as HTMLInputElement).value) / 100),
  );
  return sound;
}
