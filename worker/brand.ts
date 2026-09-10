import {MathJaxFiraFont} from '@mathjax/mathjax-fira-font/js/svg.js';

export const COLORS = Object.freeze({background:'#111311',foreground:'#edece4',symbols:'#c3c8ba',
  digits:['#eea28c','#e4c782','#9acbbb','#b8ace1']});

// Outline the wordmark with the already licensed Fira Math sans glyphs. Neither
// resvg nor the deployed Worker needs an OS font or a network font download.
function wordmark() {
  const font = new MathJaxFiraFont(), paths = [];
  let x = 71;
  for (const character of 'FORMULA CLOCK') {
    if (character === ' ') { x += 6; continue; }
    const [, ,width, data] = font.getChar('normal',character.codePointAt(0)!);
    if (!data?.p) throw new Error(`Missing brand glyph ${character}`);
    paths.push(`<path transform="translate(${x} 52.2) scale(.012 -.012)" d="M${data.p}Z"/>`);
    x += width * 12 + 2.3;
  }
  return {paths:paths.join(''),width:x - 2.3 - 50};
}
const word = wordmark();
export const BRAND = `<g id="brand" fill="${COLORS.foreground}">${COLORS.digits.map((color,i) =>
  `<circle cx="${51.5 + (i % 2) * 7}" cy="${44.5 + Math.floor(i / 2) * 7}" r="1.5" fill="${color}"/>`).join('')}${word.paths}</g>`;
const CORNER_BRAND = `<g transform="translate(50 40) scale(6) translate(-50 -43)">${BRAND}</g>`;
export const DEFAULT_BRAND = `<g transform="translate(${600 - (50 + word.width / 2) * 6} 27) scale(6)">${BRAND}</g>`;
export const canvas = (content: string,brand = CORNER_BRAND) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${COLORS.background}"/>${brand}${content}</svg>`;
