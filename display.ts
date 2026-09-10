import type {Bounds,DisplayOptions} from './types.ts';
/* Typography choices shared by the interactive clock and the OG renderer. */
const PROFILES = Object.freeze({
  stix2: Object.freeze({id:'stix2' as const, label:'STIX Two', font:'mathjax-stix2', extensions:[] as string[]}),
  termes: Object.freeze({id:'termes' as const, label:'Termes', font:'mathjax-termes', extensions:[] as string[]}),
  fira: Object.freeze({id:'fira' as const, label:'Fira', font:'mathjax-fira', extensions:[] as string[]}),
  euler: Object.freeze({id:'euler' as const, label:'Euler', font:'mathjax-modern', extensions:['mathjax-euler'] as string[]})
});
const NUMERALS = Object.freeze({lining:'Lining',oldstyle:'Oldstyle'});
const DEFAULTS = Object.freeze({font:'stix2',numerals:'oldstyle',division:'fraction'} as const);
function typography(font: DisplayOptions['font'], numerals: DisplayOptions['numerals']) {
  if (!Object.hasOwn(PROFILES,font) || !Object.hasOwn(NUMERALS,numerals)) throw new TypeError('Invalid typography');
  return Object.freeze({...PROFILES[font],numerals,oldstyle:numerals === 'oldstyle',
    centerOperators:numerals === 'lining',numericAxis:numerals === 'lining'});
}
function fitFrame(bounds: Bounds, axisY: number, width: number, height: number) {
  const axis = height / 2, margin = 15;
  const above = Math.max(1,axisY - bounds.y), below = Math.max(1,bounds.y + bounds.h - axisY);
  const scale = Math.min(112 / 1000,(width - 24) / bounds.w,(axis - margin) / above,(height - margin - axis) / below);
  return {scale,x:(width - bounds.w * scale) / 2 - bounds.x * scale,y:axis - axisY * scale,axis};
}
const api = {PROFILES,NUMERALS,DEFAULTS,typography,fitFrame};
export {PROFILES,NUMERALS,DEFAULTS,typography,fitFrame};
export default Object.freeze(api);
export type Profile = ReturnType<typeof typography>;
