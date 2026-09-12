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
    font:
      font && Object.hasOwn(Display.PROFILES, font)
        ? (font as SharedClockState['font'])
        : Display.DEFAULTS.font,
    numerals:
      numerals && Object.hasOwn(Display.NUMERALS, numerals)
        ? (numerals as SharedClockState['numerals'])
        : Display.DEFAULTS.numerals,
    division:
      division === 'fraction' || division === 'inline' || division === 'slash'
        ? division
        : Display.DEFAULTS.division,
  });
}
function params(state: SharedClockState) {
  if (
    !state ||
    !validTime(state.t) ||
    state.v !== 1 ||
    !Object.hasOwn(Display.PROFILES, state.font) ||
    !Object.hasOwn(Display.NUMERALS, state.numerals) ||
    !['fraction', 'inline', 'slash'].includes(state.division)
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
    typeof value.font !== 'string' ||
    !Object.hasOwn(Display.PROFILES, value.font) ||
    typeof value.numerals !== 'string' ||
    !Object.hasOwn(Display.NUMERALS, value.numerals) ||
    (value.division !== 'fraction' && value.division !== 'inline' && value.division !== 'slash') ||
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
    font: value.font as SharedClockState['font'],
    numerals: value.numerals as SharedClockState['numerals'],
    division: value.division,
    ast: validateAst(value.ast, value.t.slice(0, 4)),
  });
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9]{10}$/.test(value);
function id(path: string): string | null {
  const value = /^\/s\/([^/]+)$/.exec(path)?.[1];
  return validId(value) ? value : null;
}
function shortUrl(origin: string, id: string) {
  if (!validId(id)) throw new TypeError('Invalid share ID');
  return new URL(`/s/${id}`, origin);
}
function view(value: unknown): Readonly<SharedView> {
  if (!isRecord(value) || !validId(value.id)) throw new TypeError('Invalid shared view');
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
interface PreparedLink {
  id: string | null;
  promise: Promise<string>;
  controller: AbortController | null;
}
// Canonical key order without revalidating ASTs already accepted by their producer.
const snapshotKey = (state: SharedSnapshot) =>
  JSON.stringify(state, [
    'v',
    't',
    'font',
    'numerals',
    'division',
    'ast',
    'op',
    'i',
    'j',
    'a',
    'b',
  ]);
/** Small per-page cache: repeated saves of the same snapshot share one request. */
class LinkCache {
  private entries = new Map<string, PreparedLink>();
  constructor(
    initial: SharedView | null = null,
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
    private timeoutMs = 15000,
  ) {
    if (initial) {
      this.entries.set(snapshotKey(initial.snapshot), {
        id: initial.id,
        promise: Promise.resolve(initial.id),
        controller: null,
      });
    }
  }
  peek(state: SharedSnapshot): string | null {
    return this.entries.get(snapshotKey(state))?.id || null;
  }
  prepare(state: SharedSnapshot): Promise<string> {
    const key = snapshotKey(state),
      existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.promise;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const entry: PreparedLink = {
      id: null,
      controller,
      promise: Promise.resolve()
        .then(async () => {
          controller.signal.throwIfAborted();
          const response = await this.request('/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: key,
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Share creation returned ${response.status}`);
          const result: unknown = await response.json();
          controller.signal.throwIfAborted();
          if (!isRecord(result) || !validId(result.id)) throw new Error('Invalid share response');
          entry.id = result.id;
          entry.controller = null;
          return result.id;
        })
        .catch((error) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        })
        .finally(() => clearTimeout(timeout)),
    };
    this.entries.set(key, entry);
    while (this.entries.size > 12) {
      const oldest = this.entries.keys().next().value!;
      this.entries.get(oldest)?.controller?.abort();
      this.entries.delete(oldest);
    }
    return entry.promise;
  }
  cancelPending() {
    for (const [key, entry] of this.entries)
      if (entry.controller) {
        entry.controller.abort();
        this.entries.delete(key);
      }
  }
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
  LinkCache,
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
  LinkCache,
};
export default Object.freeze(api);
