/* Typography choices shared by the interactive clock and the OG renderer. */
(function (root) {
  'use strict';
  const PROFILES = Object.freeze({
    stix2: Object.freeze({id:'stix2', label:'STIX Two', font:'mathjax-stix2', extensions:[]}),
    termes: Object.freeze({id:'termes', label:'Termes', font:'mathjax-termes', extensions:[]}),
    fira: Object.freeze({id:'fira', label:'Fira', font:'mathjax-fira', extensions:[]}),
    euler: Object.freeze({id:'euler', label:'Euler', font:'mathjax-modern', extensions:['mathjax-euler']})
  });
  const NUMERALS = Object.freeze({lining:'Lining',oldstyle:'Oldstyle'});
  const DEFAULTS = Object.freeze({font:'stix2',numerals:'oldstyle',division:'fraction'});
  function typography(font, numerals) {
    if (!Object.hasOwn(PROFILES,font) || !Object.hasOwn(NUMERALS,numerals)) throw new TypeError('Invalid typography');
    return Object.freeze({...PROFILES[font],numerals,oldstyle:numerals === 'oldstyle',
      centerOperators:numerals === 'lining',numericAxis:numerals === 'lining'});
  }
  function fitFrame(bounds, axisY, width, height) {
    const axis = height / 2, margin = 15;
    const above = Math.max(1,axisY - bounds.y), below = Math.max(1,bounds.y + bounds.h - axisY);
    const scale = Math.min(112 / 1000,(width - 24) / bounds.w,(axis - margin) / above,(height - margin - axis) / below);
    return {scale,x:(width - bounds.w * scale) / 2 - bounds.x * scale,y:axis - axisY * scale,axis};
  }
  const api = {PROFILES,NUMERALS,DEFAULTS,typography,fitFrame};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormulaDisplay = Object.freeze(api);
})(typeof window === 'undefined' ? globalThis : window);
