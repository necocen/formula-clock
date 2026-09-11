import brand from './assets/brand.svg?raw';
import defaultBrand from './assets/default.svg?raw';
export const COLORS = Object.freeze({
  background: '#111311',
  foreground: '#edece4',
  symbols: '#c3c8ba',
  digits: ['#eea28c', '#e4c782', '#9acbbb', '#b8ace1'],
});

export const BRAND = brand.trim();
const CORNER_BRAND = `<g transform="translate(50 40) scale(6) translate(-50 -43)">${BRAND}</g>`;
export const DEFAULT_IMAGE = defaultBrand;
export const canvas = (content: string, brand = CORNER_BRAND) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${COLORS.background}"/>${brand}${content}</svg>`;
