import type { DisplayOptions, Expr, SharedSnapshot } from '../shared/types.ts';
import type { Typesetter } from './typesetter.ts';
import { $, pad, timeCode } from './dom.ts';
import type { DisplayedFrame, Translate } from './types.ts';
import type { MinuteSolutions } from './data-source.ts';

export interface Preview {
  epoch: number;
  started: number;
  paused: boolean;
}

export interface ClockDeps {
  t: Translate;
  stage: HTMLElement;
  sourceTime: HTMLElement;
  reducedMotion: MediaQueryList;
  settingsDialog: HTMLDialogElement;
  sharedEpoch: number | null;
  engine(): Typesetter;
  view(): DisplayOptions;
  getMinute(code: string): MinuteSolutions | undefined;
  requestMinute(code: string): void;
  render(
    ast: Expr | null,
    code: string,
    seconds: number,
    loading: boolean,
    instant?: boolean,
  ): void;
  displayedFrame(): DisplayedFrame | null;
  soundCancel(): void;
  snapshotAt(code: string, seconds: number): SharedSnapshot | null;
  leaveShared(): void;
}

export interface Clock {
  getNow(): Date;
  setPreview(date: Date, paused?: boolean): void;
  goLive(): void;
  pauseClock(): void;
  stepSecond(offset: -1 | 1): void;
  refresh(force?: boolean): void;
  resetTransport(): void;
  settle(epoch: number): void;
  forgetMinute(): void;
  renderResize(): void;
  start(): void;
  readonly preview: Preview | null;
  readonly generation: number;
}

export function createClock(deps: ClockDeps): Clock {
  const { t, sourceTime, reducedMotion } = deps;
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const b = document.createElement('button');
    b.className = 'tick' + (i % 5 === 0 ? ' major' : '');
    b.setAttribute('aria-label', t('previewSecond', { seconds: i }));
    b.addEventListener('click', () => {
      const d = getNow();
      d.setSeconds(i, 0);
      setPreview(d, true);
    });
    $('#ruler').append(b);
    return b;
  });
  // Warm only the immediately upcoming frames; do not queue a minute of work
  // ahead of interactive previews. The LRU retains recent typesetting results.
  function prepareNext(now: Date) {
    if (!deps.engine().ready || preview?.paused || document.hidden) return;
    for (const offset of [1, 2]) {
      const next = new Date(+now + offset * 1000),
        code = timeCode(next),
        result = deps.getMinute(code);
      if (result)
        deps
          .engine()
          .frame(result.solutions[next.getSeconds()] || null, code, next.getSeconds(), deps.view())
          .catch(() => {});
    }
  }
  // Transport time is anchored to the wall clock (live) or a monotonic clock (preview).
  let preview: Preview | null =
    deps.sharedEpoch === null
      ? null
      : { epoch: deps.sharedEpoch, started: performance.now(), paused: true };
  let generation = 0,
    lastSecond: number | null = null,
    lastCode: string | null = null;
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let nextPrefetch: { code: string; at: number } | null = null;
  function getNow() {
    return preview
      ? new Date(preview.epoch + (preview.paused ? 0 : performance.now() - preview.started))
      : new Date();
  }
  function setPreview(date: Date, paused = true) {
    if (!(date instanceof Date) || !Number.isFinite(+date)) return;
    deps.leaveShared();
    preview = { epoch: +date, started: performance.now(), paused };
    resetTransport();
  }
  function resetTransport() {
    generation++;
    lastSecond = null;
    deps.soundCancel();
    document.body.classList.toggle('preview-mode', !!preview);
    $('#transport').hidden = !preview;
    refresh(true);
    scheduleTick();
  }
  function goLive() {
    deps.leaveShared();
    preview = null;
    resetTransport();
  }
  function pauseClock() {
    if (preview?.paused) return;
    // Freeze the second actually on screen, even if the next frame is pending.
    const now = getNow();
    const displayed = deps.displayedFrame();
    if (displayed) {
      const { code, seconds } = displayed;
      now.setHours(Number(code.slice(0, 2)), Number(code.slice(2)), seconds, 0);
    }
    setPreview(now, true);
  }
  function stepSecond(offset: -1 | 1) {
    if (!preview?.paused) return;
    // Advance the requested time, so rapid keys accumulate before rendering.
    setPreview(new Date(Math.floor(+getNow() / 1000) * 1000 + offset * 1000), true);
  }
  function refresh(force = false) {
    const now = getNow(),
      secondKey = Math.floor(+now / 1000),
      seconds = now.getSeconds(),
      code = timeCode(now);
    const changed = secondKey !== lastSecond;
    if (!changed && !force) return;
    const previousSecond = lastSecond;
    lastSecond = secondKey;
    const result = deps.getMinute(code);
    deps.requestMinute(code);
    // Spread live hour-boundary prefetches across the first 30 seconds of :59.
    // Use clock ticks instead of a timer so skipped minutes cannot leave stale work.
    if (code !== lastCode) {
      lastCode = code;
      const next = new Date(+now);
      next.setMinutes(next.getMinutes() + 1, 0, 0);
      const minuteStart = +now - seconds * 1000 - now.getMilliseconds();
      nextPrefetch = {
        code: timeCode(next),
        at: minuteStart + (!preview && now.getMinutes() === 59 ? Math.random() * 30000 : 0),
      };
    }
    if (nextPrefetch && (preview || +now >= nextPrefetch.at)) {
      deps.requestMinute(nextPrefetch.code);
      nextPrefetch = null;
    }
    sourceTime.setAttribute(
      'aria-label',
      t('clockTime', {
        hours: pad(now.getHours()),
        minutes: pad(now.getMinutes()),
        seconds: pad(seconds),
      }),
    );
    const snapshot = deps.snapshotAt(code, seconds),
      ast = snapshot ? snapshot.ast : result?.solutions[seconds] || null;
    deps.render(ast, code, seconds, !result);
    prepareNext(now);
    ticks.forEach((el, i) => {
      const saved = deps.snapshotAt(code, i),
        entry = saved ? saved.ast : result?.solutions[i];
      el.classList.toggle('solved', !!entry);
      el.classList.toggle('current', i === seconds);
      el.classList.toggle('past', i < seconds);
      if (i === seconds) el.setAttribute('aria-current', 'time');
      else el.removeAttribute('aria-current');
      const status = t(
        saved
          ? saved.ast
            ? 'formulaAvailable'
            : 'noFormula'
          : result
            ? result.error
              ? 'dataFailed'
              : entry
                ? 'formulaAvailable'
                : 'noFormula'
            : 'loading',
      );
      el.title = t('secondStatus', { seconds: pad(i), status });
    });
    const label = $('#state-label');
    label.className = 'state-label';
    if (now.getHours() === 23 && now.getMinutes() === 59 && seconds >= 57) {
      label.textContent = t('newDayIn', { seconds: 60 - seconds });
      label.classList.add('counting');
    } else if (now.getHours() === 0 && now.getMinutes() === 0 && seconds === 0) {
      label.textContent = t('newDay');
      label.classList.add('counting');
    } else if (snapshot) label.textContent = '';
    else if (!result) label.textContent = t('loadingData');
    else if (result.error) label.textContent = t('dataClockFallback');
    else if (!ast) {
      label.textContent = '';
      label.classList.add('quiet');
    } else label.textContent = '';
    if (changed && previousSecond !== null && seconds === 0 && !preview?.paused) {
      $('#flash').animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], {
        duration: reducedMotion.matches ? 200 : 1650,
      });
    }
  }
  function scheduleTick() {
    clearTimeout(tickTimer);
    if (preview?.paused) return;
    const now = +getNow();
    const delay = Math.max(12, 1000 - (now % 1000) + 3);
    tickTimer = setTimeout(() => {
      refresh();
      scheduleTick();
    }, delay);
  }
  function renderResize() {
    const d = getNow(),
      code = timeCode(d),
      result = deps.getMinute(code);
    deps.render(result?.solutions[d.getSeconds()] || null, code, d.getSeconds(), !result, true);
  }
  $<HTMLButtonElement>('#go-live').addEventListener('click', goLive);
  $<HTMLButtonElement>('#custom-go').addEventListener('click', () => {
    const value = $<HTMLInputElement>('#custom-time').value;
    if (!/^\d\d:\d\d(?::\d\d)?$/.test(value)) return;
    const [h, m, s = 0] = value.split(':').map(Number),
      d = new Date();
    d.setHours(h, m, s, 0);
    setPreview(d, true);
    deps.settingsDialog.close();
  });
  function start() {
    new ResizeObserver(renderResize).observe(deps.stage);
    reducedMotion.addEventListener?.('change', renderResize);
    document.addEventListener('visibilitychange', () => {
      deps.soundCancel();
      if (document.hidden) clearTimeout(tickTimer);
      else {
        lastSecond = null;
        refresh(true);
        scheduleTick();
      }
    });
    if (deps.sharedEpoch !== null) resetTransport();
    else {
      refresh(true);
      scheduleTick();
    }
  }
  return {
    getNow,
    setPreview,
    goLive,
    pauseClock,
    stepSecond,
    refresh,
    resetTransport,
    settle(epoch) {
      preview = { epoch, started: performance.now(), paused: true };
      resetTransport();
    },
    forgetMinute() {
      lastCode = null;
    },
    renderResize,
    start,
    get preview() {
      return preview;
    },
    get generation() {
      return generation;
    },
  };
}
