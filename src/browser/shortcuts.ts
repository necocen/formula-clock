export interface ShortcutsDeps {
  dialogsOpen(): boolean;
  previewPaused(): boolean;
  stepSecond(offset: -1 | 1): void;
  goLive(): void;
  pauseClock(): void;
  toggleSound(): void;
  toggleFullscreen(): void;
}

export function installShortcuts(deps: ShortcutsDeps): void {
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (
      deps.dialogsOpen() ||
      e.defaultPrevented ||
      e.isComposing ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      (target instanceof Element && target.closest('input,textarea,select')) ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;
    // Ruler buttons retain focus after a click; arrows should still seek there.
    if (!e.shiftKey && deps.previewPaused() && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      deps.stepSecond(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (target instanceof Element && target.closest('button,summary,a')) return;
    if (e.repeat) {
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    if (e.key.toLowerCase() === 'm') deps.toggleSound();
    if (e.key.toLowerCase() === 'l') deps.goLive();
    if (e.key.toLowerCase() === 'f') deps.toggleFullscreen();
    if (e.code === 'Space') {
      e.preventDefault();
      if (deps.previewPaused()) deps.goLive();
      else deps.pauseClock();
    }
  });
}
