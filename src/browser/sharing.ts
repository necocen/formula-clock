import {
  isRecord,
  type DisplayOptions,
  type Expr,
  type SharedSnapshot,
  type SharedView,
} from '../shared/types.ts';
import FormulaShare from '../shared/share.ts';
import { $, pad, timeCode } from './dom.ts';
import type { DisplayedFrame, Frame, Translate } from './types.ts';
import type { MinuteSolutions } from './data-source.ts';

export interface FrameCommit {
  code: string;
  seconds: number;
  loading: boolean;
  view: DisplayOptions;
  ast: Expr | null;
}

export function readInitialShare() {
  let sharedView: SharedView | null = null;
  try {
    const embedded = document.querySelector('#shared-clock');
    if (embedded) {
      const candidate = FormulaShare.view(JSON.parse(embedded.textContent || ''));
      if (candidate.id === FormulaShare.id(location.pathname)) sharedView = candidate;
    }
  } catch (error) {
    console.warn('[Formula Clock] Invalid shared snapshot.', error);
  }
  const state = sharedView?.snapshot || FormulaShare.parse(new URL(location.href));
  return { view: sharedView, state };
}

export interface SharingDeps {
  t: Translate;
  shareButton: HTMLButtonElement;
  shareDialog: HTMLDialogElement;
  sharedView: SharedView | null;
  initiallyShared: boolean;
  displayedFrame(): DisplayedFrame | null;
  applyFrame(
    frame: Frame,
    ast: Expr | null,
    code: string,
    seconds: number,
    loading: boolean,
    instant: boolean,
    view: DisplayOptions,
  ): void;
  invalidate(): void;
  cancelPending(): void;
  finishAnimations(): void;
  engineError(): string | null;
  hasMinute(code: string): boolean;
  getMinute(code: string): MinuteSolutions | undefined;
  settle(epoch: number): void;
  previewPaused(): boolean;
  kick(): void;
  adoptView(view: Pick<DisplayOptions, 'font' | 'numerals' | 'division'>): void;
}

export interface Sharing {
  snapshotAt(code: string, seconds: number): SharedSnapshot | null;
  leaveSharedView(keepFormula?: boolean): void;
  showNotice(text: string): void;
  frameCommitted(commit: FrameCommit): void;
}

export function createSharing(deps: SharingDeps): Sharing {
  const { t, shareButton, shareDialog } = deps;
  let activeSnapshot: SharedSnapshot | null = deps.sharedView?.snapshot || null;
  let sharedAddress = deps.initiallyShared;
  const shareLinks = new FormulaShare.LinkCache(deps.sharedView);
  let shareSerial = 0,
    shareBusy = false;
  let shareWarmTimer: ReturnType<typeof setTimeout> | undefined,
    shareWarmKey = '';
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function snapshotAt(code: string, seconds: number) {
    return activeSnapshot?.t === code + pad(seconds) ? activeSnapshot : null;
  }
  function leaveSharedView(keepFormula = false) {
    if (!keepFormula) activeSnapshot = null;
    ++shareSerial;
    shareLinks.cancelPending();
    clearTimeout(shareWarmTimer);
    shareWarmKey = '';
    shareBusy = false;
    deps.invalidate();
    shareButton.removeAttribute('aria-busy');
    showNotice('');
    if (shareDialog.open) shareDialog.close();
    if (sharedAddress) {
      const target = new URL(location.href);
      target.search = '';
      target.hash = '';
      // file:// previews retain their pathname; changing it would fail the origin check.
      if (['http:', 'https:'].includes(target.protocol)) target.pathname = '/';
      history.replaceState(history.state, '', target);
      document.title = FormulaShare.title(null);
      sharedAddress = false;
    }
  }
  function showNotice(text: string) {
    clearTimeout(noticeTimer);
    $('#share-status').textContent = text;
    noticeTimer = setTimeout(() => {
      $('#share-status').textContent = '';
    }, 4000);
  }
  function manualShare(url: string) {
    const input = $<HTMLInputElement>('#share-url');
    input.value = url;
    $<HTMLButtonElement>('#share-native').hidden = typeof navigator.share !== 'function';
    if (!shareDialog.open) shareDialog.showModal();
    input.focus();
    input.select();
  }
  async function copyShare(url: string, serial = shareSerial) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (serial === shareSerial) {
        if (shareDialog.open) shareDialog.close();
        showNotice(t('shareCopied'));
      }
    } catch {
      if (serial === shareSerial) manualShare(url);
    }
  }
  function deliverShare(url: string, state: SharedSnapshot, serial: number) {
    if (serial !== shareSerial) return;
    if (typeof navigator.share !== 'function') {
      void copyShare(url, serial);
      return;
    }
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      manualShare(url);
      return;
    }
    const failed = (error: unknown) => {
      if (
        serial !== shareSerial ||
        ((isRecord(error) || error instanceof Error) && error.name === 'AbortError')
      )
        return;
      manualShare(url);
    };
    const card = FormulaShare.card(state);
    try {
      void navigator.share({ title: card.title, url }).catch(failed);
    } catch (error) {
      failed(error);
    }
  }
  function displayedSnapshot(): SharedSnapshot | null {
    const displayed = deps.displayedFrame();
    if (!displayed || shareButton.disabled || shareButton.hidden || document.hidden) return null;
    const { code, seconds, view, ast } = displayed;
    return FormulaShare.snapshot({
      v: 1,
      t: code + pad(seconds),
      font: view.font,
      numerals: view.numerals,
      division: view.division,
      ast,
    });
  }
  function preparePausedShare() {
    const state = deps.previewPaused() ? displayedSnapshot() : null;
    if (!state) {
      clearTimeout(shareWarmTimer);
      return;
    }
    const key = JSON.stringify(state);
    if (key === shareWarmKey) return;
    clearTimeout(shareWarmTimer);
    shareWarmKey = key;
    const serial = shareSerial;
    // Coalesce quick ruler/settings changes; failures stay quiet until a real share.
    shareWarmTimer = setTimeout(() => {
      if (serial === shareSerial && JSON.stringify(displayedSnapshot()) === key)
        void shareLinks.prepare(state).catch(() => {});
    }, 250);
  }
  function prepareShareOnIntent() {
    const state = displayedSnapshot();
    if (!state) return;
    void shareLinks.prepare(state).catch(() => {});
    if (deps.previewPaused()) return;
    // Only this gesture warms the next two seconds; the running clock never
    // continuously writes to KV. Exact AST/settings keys guard second boundaries.
    const now = FormulaShare.localDate(state.t);
    for (const offset of [1, 2]) {
      const next = new Date(+now + offset * 1000),
        code = timeCode(next),
        result = deps.getMinute(code);
      if (!result || result.error) continue;
      void shareLinks
        .prepare({
          ...state,
          t: code + pad(next.getSeconds()),
          ast: result.solutions[next.getSeconds()] || null,
        })
        .catch(() => {});
    }
  }
  function frameCommitted({ code, seconds, loading, view, ast }: FrameCommit) {
    if (sharedAddress && !loading && !deps.engineError())
      document.title = FormulaShare.title({ v: 1, t: code + pad(seconds), ...view, ast });
    shareButton.disabled =
      shareBusy ||
      loading ||
      !!deps.engineError() ||
      (!snapshotAt(code, seconds) && (!deps.hasMinute(code) || !!deps.getMinute(code)?.error));
    preparePausedShare();
  }
  for (const event of ['pointerenter', 'focus', 'pointerdown'])
    shareButton.addEventListener(event, prepareShareOnIntent);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(shareWarmTimer);
      shareWarmKey = '';
      if (!shareBusy) shareLinks.cancelPending();
    } else preparePausedShare();
  });
  $('#share-copy').addEventListener('click', () => {
    void copyShare($<HTMLInputElement>('#share-url').value);
  });
  $('#share-native').addEventListener('click', () => {
    if (activeSnapshot)
      deliverShare($<HTMLInputElement>('#share-url').value, activeSnapshot, shareSerial);
  });
  shareButton.addEventListener('click', async () => {
    const snapshot = deps.displayedFrame();
    if (shareButton.disabled || !snapshot) return;
    const { code, seconds, view } = snapshot;
    const state = FormulaShare.snapshot({
      v: 1,
      t: code + pad(seconds),
      font: view.font,
      numerals: view.numerals,
      division: view.division,
      ast: snapshot.ast,
    });
    // Invalidate work for a newer second and settle the frame the user saw.
    // Capture the AST before any network await, including an ordinary null frame.
    deps.adoptView({ font: state.font, numerals: state.numerals, division: state.division });
    activeSnapshot = state;
    deps.settle(+FormulaShare.localDate(state.t));
    deps.cancelPending();
    deps.finishAnimations();
    deps.applyFrame(snapshot.frame, snapshot.ast, code, seconds, false, true, view);
    showNotice('');
    clearTimeout(shareWarmTimer);
    shareWarmKey = JSON.stringify(state);
    const serial = ++shareSerial,
      preparedId = shareLinks.peek(state);
    if (preparedId) {
      deliverShare(FormulaShare.shortUrl(location.origin, preparedId).href, state, serial);
      return;
    }
    shareBusy = true;
    shareButton.disabled = true;
    shareButton.setAttribute('aria-busy', 'true');
    try {
      const id = await shareLinks.prepare(state),
        url = FormulaShare.shortUrl(location.origin, id).href;
      if (serial !== shareSerial) return;
      showNotice('');
      deliverShare(url, state, serial);
    } catch {
      if (serial === shareSerial) showNotice(t('shareFailed'));
    } finally {
      if (serial === shareSerial) {
        shareBusy = false;
        shareButton.removeAttribute('aria-busy');
        deps.invalidate();
        deps.kick();
      }
    }
  });
  return { snapshotAt, leaveSharedView, showNotice, frameCommitted };
}
