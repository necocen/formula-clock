/* Stateless DOM helpers shared by the browser app modules. */
export function $<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing clock element ${selector}`);
  return element;
}
export const pad = (n: number) => String(n).padStart(2, '0');
export const timeCode = (d: Date) => pad(d.getHours()) + pad(d.getMinutes());
export function setupDialog(
  dialog: HTMLDialogElement,
  opener: HTMLButtonElement,
  closeButton: HTMLButtonElement,
  openOnClick = true,
) {
  if (openOnClick)
    opener.addEventListener('click', () => {
      dialog.showModal();
      closeButton.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener.focus({ preventScroll: true }));
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>('button,input,select,summary,a[href]'),
    ].filter((el) => !('disabled' in el && el.disabled) && el.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  // Dragging out from a control must not count as a backdrop click.
  let backdropPointer = false;
  function outsideDialog(event: Pick<MouseEvent, 'clientX' | 'clientY'>) {
    const r = dialog.getBoundingClientRect();
    return (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    );
  }
  dialog.addEventListener('pointerdown', (event) => {
    backdropPointer = outsideDialog(event);
  });
  dialog.addEventListener('click', (event) => {
    if (backdropPointer && outsideDialog(event)) dialog.close();
    backdropPointer = false;
  });
  // A backdrop tap can finish without a compatibility click.
  // Finish taps directly, and suppress that click so it cannot hit the page below.
  let backdropTouch: Touch | undefined;
  dialog.addEventListener(
    'touchstart',
    (event) => {
      const touch = event.touches[0];
      backdropTouch = event.touches.length === 1 && outsideDialog(touch) ? touch : undefined;
    },
    { passive: true },
  );
  dialog.addEventListener(
    'touchmove',
    (event) => {
      const touch = [...event.touches].find(
        (touch) => touch.identifier === backdropTouch?.identifier,
      );
      if (
        backdropTouch &&
        (!touch ||
          Math.hypot(touch.clientX - backdropTouch.clientX, touch.clientY - backdropTouch.clientY) >
            10)
      ) {
        backdropTouch = undefined;
      }
    },
    { passive: true },
  );
  dialog.addEventListener(
    'touchend',
    (event) => {
      const start = backdropTouch;
      backdropTouch = undefined;
      backdropPointer = false;
      const touch = [...event.changedTouches].find(
        (touch) => touch.identifier === start?.identifier,
      );
      if (
        start &&
        touch &&
        event.touches.length === 0 &&
        outsideDialog(touch) &&
        Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY) <= 10
      ) {
        event.preventDefault();
        dialog.close();
      }
    },
    { passive: false },
  );
  for (const type of ['touchcancel', 'close']) {
    dialog.addEventListener(type, () => {
      backdropTouch = undefined;
      backdropPointer = false;
    });
  }
}
