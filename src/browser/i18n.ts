import I18n from '../shared/i18n.ts';
import type { MessageKey } from '../shared/i18n.ts';

export function create(language: unknown) {
  const { locale, t } = I18n.create(language);
  function apply(document: Document) {
    document.documentElement.lang = locale;
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]'))
      element.textContent = t(element.dataset.i18n as MessageKey);
    for (const attribute of ['title', 'aria-label']) {
      for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
        element.setAttribute(
          attribute,
          t(element.getAttribute(`data-i18n-${attribute}`) as MessageKey),
        );
      }
    }
  }
  return Object.freeze({ locale, t, apply });
}

export default Object.freeze({ ...I18n, create });
