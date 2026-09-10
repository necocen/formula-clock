import type {SharedClockState} from './types.ts';
/* A shared link identifies a wall-clock reading, never a date or an instant. */
import * as Display from './display.ts';
const validTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]$/.test(value);
function parse(url: string | URL): Readonly<SharedClockState> | null {
  const p = (url instanceof URL ? url : new URL(url)).searchParams;
  const time = p.get('t'), font = p.get('font'), numerals = p.get('numerals'), division = p.get('division');
  if (!validTime(time) || (p.has('v') && p.get('v') !== '1')) return null;
  return Object.freeze({v:1,t:time,
    font:font && Object.hasOwn(Display.PROFILES,font) ? font as SharedClockState['font'] : Display.DEFAULTS.font,
    numerals:numerals && Object.hasOwn(Display.NUMERALS,numerals) ? numerals as SharedClockState['numerals'] : Display.DEFAULTS.numerals,
    division:division === 'fraction' || division === 'inline' ? division : Display.DEFAULTS.division});
}
function params(state: SharedClockState) {
  if (!state || !validTime(state.t) || state.v !== 1 || !Object.hasOwn(Display.PROFILES,state.font) ||
      !Object.hasOwn(Display.NUMERALS,state.numerals) || !['fraction','inline'].includes(state.division)) {
    throw new TypeError('Invalid shared clock state');
  }
  return new URLSearchParams({v:'1',t:state.t,font:state.font,numerals:state.numerals,division:state.division});
}
function url(origin: string, state: SharedClockState) {
  const result = new URL('/',origin);
  result.search = params(state).toString();
  return result;
}
function timeLabel(state: SharedClockState) { return state.t.match(/../g)!.join(':'); }
function title(state: SharedClockState | null) { return state ? `Formula Clock — ${timeLabel(state)}` : 'Formula Clock'; }
function localDate(time: string) {
  if (!validTime(time)) throw new TypeError('Invalid shared time');
  // A fixed calendar day avoids a spring-forward gap on the day the URL opens.
  return new Date(2000,0,15,Number(time.slice(0,2)),Number(time.slice(2,4)),Number(time.slice(4)),0);
}
const api = {parse,params,url,timeLabel,title,localDate};
export {parse,params,url,timeLabel,title,localDate};
export default Object.freeze(api);
