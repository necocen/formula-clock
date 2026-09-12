import {
  isRecord,
  type SharedClockState,
  type SharedSnapshot,
  type SharedView,
  type Expr,
} from './types.ts';
/* A shared link identifies a wall-clock reading, never a date or an instant. */
import * as Display from './display.ts';
import { validateAst, plain, compact } from './expression.ts';
const validTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]$/.test(value);
function parse(url: string | URL): Readonly<SharedClockState> | null {
  const p = (url instanceof URL ? url : new URL(url)).searchParams;
  const time = p.get('t'),
    font = p.get('font'),
    numerals = p.get('numerals'),
    division = p.get('division');
  if (!validTime(time) || (p.has('v') && p.get('v') !== '1')) return null;
  return Object.freeze({
    v: 1,
    t: time,
    font: Display.isFont(font) ? font : Display.DEFAULTS.font,
    numerals: Display.isNumerals(numerals) ? numerals : Display.DEFAULTS.numerals,
    division: Display.isDivision(division) ? division : Display.DEFAULTS.division,
  });
}
function params(state: SharedClockState) {
  if (
    !state ||
    !validTime(state.t) ||
    state.v !== 1 ||
    !Display.isFont(state.font) ||
    !Display.isNumerals(state.numerals) ||
    !Display.isDivision(state.division)
  ) {
    throw new TypeError('Invalid shared clock state');
  }
  return new URLSearchParams({
    v: '1',
    t: state.t,
    font: state.font,
    numerals: state.numerals,
    division: state.division,
  });
}
function url(origin: string, state: SharedClockState) {
  const result = new URL('/', origin);
  result.search = params(state).toString();
  return result;
}
function snapshot(value: unknown): Readonly<SharedSnapshot> {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !validTime(value.t) ||
    !Display.isFont(value.font) ||
    !Display.isNumerals(value.numerals) ||
    !Display.isDivision(value.division) ||
    !Object.hasOwn(value, 'ast') ||
    Object.keys(value).some(
      (key) => !['v', 't', 'font', 'numerals', 'division', 'ast'].includes(key),
    )
  ) {
    throw new TypeError('Invalid shared snapshot');
  }
  return Object.freeze({
    v: 1,
    t: value.t,
    font: value.font,
    numerals: value.numerals,
    division: value.division,
    ast: validateAst(value.ast, value.t.slice(0, 4)),
  });
}
const isShareId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9]{10}$/.test(value);
function id(path: string): string | null {
  const value = /^\/s\/([^/]+)$/.exec(path)?.[1];
  return isShareId(value) ? value : null;
}
function shortUrl(origin: string, id: string) {
  if (!isShareId(id)) throw new TypeError('Invalid share ID');
  return new URL(`/s/${id}`, origin);
}
function view(value: unknown): Readonly<SharedView> {
  if (!isRecord(value) || !isShareId(value.id)) throw new TypeError('Invalid shared view');
  return Object.freeze({ id: value.id, snapshot: snapshot(value.snapshot) });
}
function timeLabel(state: SharedClockState) {
  return state.t.match(/../g)!.join(':');
}
function title(state: (SharedClockState & { readonly ast?: Expr | null }) | null) {
  if (!state) return 'Formula Clock';
  return state.ast
    ? `${plain(state.ast, state.t.slice(0, 4), { division: '/' })} = ${Number(state.t.slice(4))}`
    : `Formula Clock — ${timeLabel(state)}`;
}
function card(state: (SharedClockState & { readonly ast?: Expr | null }) | null) {
  return {
    title: state ? `Formula Clock - ${timeLabel(state)}` : 'Formula Clock',
    description: state
      ? state.ast
        ? `${compact(state.ast, state.t.slice(0, 4))}=${Number(state.t.slice(4))}`
        : timeLabel(state)
      : null,
  };
}
function localDate(time: string) {
  if (!validTime(time)) throw new TypeError('Invalid shared time');
  // A fixed calendar day avoids a spring-forward gap on the day the URL opens.
  return new Date(
    2000,
    0,
    15,
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4)),
    0,
  );
}
const api = {
  parse,
  params,
  url,
  snapshot,
  id,
  shortUrl,
  view,
  timeLabel,
  title,
  card,
  localDate,
  isShareId,
};
export {
  parse,
  params,
  url,
  snapshot,
  id,
  shortUrl,
  view,
  timeLabel,
  title,
  card,
  localDate,
  isShareId,
};
export default Object.freeze(api);
