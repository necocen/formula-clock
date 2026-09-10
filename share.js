/* A shared link identifies a wall-clock reading, never a date or an instant. */
(function (root) {
  'use strict';
  const Display = typeof module !== 'undefined' && module.exports ? require('./display.js') : root.FormulaDisplay;
  const validTime = value => typeof value === 'string' && /^(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]$/.test(value);
  function parse(url) {
    const p = (url instanceof URL ? url : new URL(url)).searchParams;
    if (!validTime(p.get('t')) || (p.has('v') && p.get('v') !== '1')) return null;
    return Object.freeze({v:1,t:p.get('t'),
      font:Object.hasOwn(Display.PROFILES,p.get('font')) ? p.get('font') : Display.DEFAULTS.font,
      numerals:Object.hasOwn(Display.NUMERALS,p.get('numerals')) ? p.get('numerals') : Display.DEFAULTS.numerals,
      division:['fraction','inline'].includes(p.get('division')) ? p.get('division') : Display.DEFAULTS.division});
  }
  function params(state) {
    if (!state || !validTime(state.t) || state.v !== 1 || !Object.hasOwn(Display.PROFILES,state.font) ||
        !Object.hasOwn(Display.NUMERALS,state.numerals) || !['fraction','inline'].includes(state.division)) {
      throw new TypeError('Invalid shared clock state');
    }
    return new URLSearchParams({v:'1',t:state.t,font:state.font,numerals:state.numerals,division:state.division});
  }
  function url(origin, state) {
    const result = new URL('/',origin);
    result.search = params(state).toString();
    return result;
  }
  function timeLabel(state) { return state.t.match(/../g).join(':'); }
  function title(state) { return state ? `Formula Clock — ${timeLabel(state)}` : 'Formula Clock'; }
  function localDate(time) {
    if (!validTime(time)) throw new TypeError('Invalid shared time');
    // A fixed calendar day avoids a spring-forward gap on the day the URL opens.
    return new Date(2000,0,15,Number(time.slice(0,2)),Number(time.slice(2,4)),Number(time.slice(4)),0);
  }
  const api = {parse,params,url,timeLabel,title,localDate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormulaShare = Object.freeze(api);
})(typeof window === 'undefined' ? globalThis : window);
