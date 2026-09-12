import type { FormulaProvider } from '../shared/types.ts';
import FormulaI18n from './i18n.ts';
import FormulaShare from '../shared/share.ts';
import { $, pad, timeCode, setupDialog } from './dom.ts';
import { createTimeSignal } from './audio.ts';
import { assertProvider, createDataSource } from './data-source.ts';
import { createSettings } from './settings.ts';
import { createFullscreen } from './fullscreen.ts';
import { createSharing, readInitialShare } from './sharing.ts';
import { createClock, type Clock } from './clock.ts';
import { installShortcuts } from './shortcuts.ts';
import { createRenderer } from './renderer.ts';
// The default provider registers itself on FORMULA_CLOCK_CONFIG before the app reads it.
import './provider.ts';

/* Formula Clock: persistent digit objects, separate typography and data delivery. */
const ui = FormulaI18n.create(navigator.languages?.[0] || navigator.language),
  t = ui.t;
ui.apply(document);
const stage = $('#stage');
const sourceTime = $('#source-time');
const settingsDialog = $<HTMLDialogElement>('#settings'),
  settingsButton = $<HTMLButtonElement>('#settings-open');
const licenseDialog = $<HTMLDialogElement>('#licenses');
const shareButton = $<HTMLButtonElement>('#share'),
  shareDialog = $<HTMLDialogElement>('#share-dialog');
const { view: sharedView, state: sharedState } = readInitialShare();
setupDialog(settingsDialog, settingsButton, $<HTMLButtonElement>('#settings-close'));
setupDialog(
  licenseDialog,
  $<HTMLButtonElement>('#licenses-open'),
  $<HTMLButtonElement>('#licenses-close'),
);
setupDialog(shareDialog, shareButton, $<HTMLButtonElement>('#share-close'), false);
// Composed after the renderer block; late-bound closures fire only from
// event listeners, promise continuations, and timers.
let clock!: Clock;
const data = createDataSource({
  isCurrentCode: (code) => timeCode(clock.getNow()) === code,
  kick: () => clock.refresh(true),
});
if (sharedState) document.title = FormulaShare.title(sharedState);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function setDataProvider(next: FormulaProvider) {
  assertProvider(next);
  sharing.leaveSharedView();
  data.replaceProvider(next);
  renderer.invalidate();
  clock.forgetMinute();
  renderer.cancelPending();
  clock.refresh(true);
}

const settings = createSettings({
  settingsDialog,
  shareButton,
  sharedState,
  leaveShared: (keepFormula) => sharing.leaveSharedView(keepFormula),
  invalidate: () => renderer.invalidate(),
  kick: () => clock.refresh(true),
  setEngineError: (message) => renderer.setEngineError(message),
});
const renderer = createRenderer({
  t,
  stage,
  sourceTime,
  shareButton,
  reducedMotion,
  engine: () => settings.engine(),
  view: () => settings.view(),
  face: (font, numerals) => settings.face(font, numerals),
  snapshotAt: (code, seconds) => sharing.snapshotAt(code, seconds),
  onFrameCommitted: (commit) => sharing.frameCommitted(commit),
  prepare: () => {
    settings.prepareFace();
    clock.prepareNext();
  },
});
const sharing = createSharing({
  t,
  shareButton,
  shareDialog,
  sharedView,
  initiallyShared: !!sharedState,
  displayedFrame: () => renderer.displayed,
  applyFrame: (frame, ast, code, seconds, loading, instant, view) =>
    renderer.applyFrame(frame, ast, code, seconds, loading, instant, view),
  invalidate: () => renderer.invalidate(),
  cancelPending: () => renderer.cancelPending(),
  finishAnimations: () => renderer.finishAnimations(),
  engineError: () => renderer.engineError,
  hasMinute: (code) => data.hasMinute(code),
  getMinute: (code) => data.getMinute(code),
  settle: (epoch) => clock.settle(epoch),
  kick: () => clock.refresh(true),
  adoptView: (view) => settings.adoptView(view),
});

const sound = createTimeSignal({
  t,
  notify: (text) => sharing.showNotice(text),
  getNow: () => clock.getNow(),
  isPaused: () => !!clock.preview?.paused,
  generation: () => clock.generation,
});
clock = createClock({
  t,
  stage,
  sourceTime,
  reducedMotion,
  settingsDialog,
  sharedEpoch: sharedState ? +FormulaShare.localDate(sharedState.t) : null,
  engine: () => settings.engine(),
  view: () => settings.view(),
  getMinute: (code) => data.getMinute(code),
  requestMinute: (code) => data.request(code),
  render: (ast, code, seconds, loading, instant) =>
    renderer.render(ast, code, seconds, loading, instant),
  displayedFrame: () => renderer.displayed,
  soundCancel: () => sound.cancel(),
  snapshotAt: (code, seconds) => sharing.snapshotAt(code, seconds),
  leaveShared: () => sharing.leaveSharedView(),
});
const fullscreen = createFullscreen({
  t,
  notify: (text) => sharing.showNotice(text),
  renderResize: () => clock.renderResize(),
});
installShortcuts({
  dialogsOpen: () => settingsDialog.open || licenseDialog.open || shareDialog.open,
  previewPaused: () => !!clock.preview?.paused,
  stepSecond: (offset) => clock.stepSecond(offset),
  goLive: () => clock.goLive(),
  pauseClock: () => clock.pauseClock(),
  toggleSound: () => {
    sound.toggle();
  },
  toggleFullscreen: () => {
    fullscreen.toggle();
  },
});
clock.start();
setInterval(() => sound.poll(), 60);
// Read-only handles for tests, with explicit transport controls for reproducible previews.
window.FormulaClock = Object.freeze({
  preview: (time: string | Date, paused = true) => {
    const d = time instanceof Date ? time : new Date(time);
    clock.setPreview(d, paused);
  },
  live: () => clock.goLive(),
  pause: () => clock.pauseClock(),
  setDisplay: settings.setDisplay,
  setDataProvider,
  get state() {
    return {
      display: { ...settings.current },
      dataRevision: data.revision,
      dataError: data.getMinute(timeCode(clock.getNow()))?.error || null,
      now: clock.getNow().toISOString(),
      preview: !!clock.preview,
      paused: clock.preview?.paused || false,
      layout: renderer.layout,
      coverage: data.getMinute(timeCode(clock.getNow()))?.count,
      audio: sound.history(),
      soundEnabled: sound.enabled,
      soundReady: sound.ready,
      soundVolume: sound.volume,
      engineReady: settings.engine().ready,
      engineError: renderer.engineError,
      typesetCacheSize: settings.engine().cache.size,
    };
  },
  get digits() {
    return renderer.digits();
  },
  diagnostics() {
    const layout = renderer.layout;
    return {
      build: 'r6-minimal',
      mathjax: settings.engine().mathjax?.version || null,
      display: { ...settings.current },
      userAgent: navigator.userAgent,
      locale: ui.locale,
      engineError: renderer.engineError,
      typography: settings.engine().typography,
      axisY: layout?.axisY,
      localAxisY: layout?.localAxisY,
      time: layout ? `${layout.code}:${pad(layout.seconds)}` : null,
      glyphs: renderer.glyphDiagnostics(),
    };
  },
});
