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
  function outsideDialog(event: MouseEvent) {
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
}
