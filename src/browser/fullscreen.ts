import { $ } from './dom.ts';
import type { Translate } from './types.ts';

export interface FullscreenDeps {
  t: Translate;
  notify(text: string): void;
  renderResize(): void;
}

export interface Fullscreen {
  toggle(): Promise<void>;
}

export function createFullscreen(deps: FullscreenDeps): Fullscreen {
  const { t } = deps;
  const fullscreenButton = $<HTMLButtonElement>('#fullscreen');
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function fullscreenApi() {
    const element = document.documentElement;
    if (document.fullscreenEnabled && typeof element.requestFullscreen === 'function') {
      return { enter: () => element.requestFullscreen(), exit: () => document.exitFullscreen() };
    }
    if (document.webkitFullscreenEnabled && typeof element.webkitRequestFullscreen === 'function') {
      return {
        enter: () => element.webkitRequestFullscreen!(),
        exit: () => document.webkitExitFullscreen!(),
      };
    }
    return null;
  }
  function paintFullscreen() {
    const active = !!fullscreenElement(),
      label = t(active ? 'exitFullscreen' : 'fullscreen');
    fullscreenButton.hidden = !active && !fullscreenApi();
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.setAttribute('aria-label', label);
    fullscreenButton.title = t('shortcut', { label, key: 'F' });
    document.body.classList.toggle('fullscreen', active);
  }
  async function toggle() {
    const api = fullscreenApi();
    if (!api) return;
    try {
      await (fullscreenElement() ? api.exit() : api.enter());
    } catch {
      deps.notify(t('fullscreenFailed'));
    } finally {
      paintFullscreen();
    }
  }
  fullscreenButton.addEventListener('click', toggle);
  for (const event of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(event, () => {
      paintFullscreen();
      deps.renderResize();
    });
  }
  paintFullscreen();
  return { toggle };
}
