import {
  isRecord,
  type FormulaProvider,
  type MinuteRecord,
  type FetchHourOptions,
} from './types.ts';
type ReadOptions = { signal?: AbortSignal };
// Only the header is checked here; each minute/AST is validated when consumed.
interface RawTable {
  schema: 'formula-clock/1';
  minutes: Record<string, unknown>;
}
interface Manifest {
  version: string;
  urls: Readonly<Record<string, string>>;
}
type HourRecords = Map<string, MinuteRecord>;
/* Delivery is independent of expression syntax and display options.
 * Provider contract: getMinute(hhmm, {signal}) -> Promise<MinuteRecord>.
 */
import * as Expr from './expression.ts';
const SCHEMA = 'formula-clock/1';
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
function normalizeMinute(record: unknown, expectedCode: string): MinuteRecord {
  Expr.assertCode(expectedCode);
  if (
    !isRecord(record) ||
    record.schema !== SCHEMA ||
    record.hhmm !== expectedCode ||
    !Array.isArray(record.seconds) ||
    record.seconds.length !== 60
  ) {
    throw new TypeError(`Expected ${SCHEMA}, hhmm=${expectedCode}, and exactly 60 second entries`);
  }
  // Array.from visits holes, so an omitted element cannot silently mean null.
  const seconds = Array.from(record.seconds, (ast) => Expr.validateAst(ast, expectedCode));
  return Object.freeze({ schema: SCHEMA, hhmm: expectedCode, seconds: Object.freeze(seconds) });
}
function tableHeader(table: unknown): asserts table is RawTable {
  if (!isRecord(table) || table.schema !== SCHEMA || !isRecord(table.minutes)) {
    throw new TypeError('Invalid formula table');
  }
  Object.keys(table.minutes).forEach(Expr.assertCode);
}
class InlineProvider implements FormulaProvider {
  private table: RawTable;
  private cache = new Map<string, MinuteRecord>();
  constructor(table: unknown) {
    tableHeader(table);
    this.table = table;
  }
  async getMinute(hhmm: string, { signal }: ReadOptions = {}): Promise<MinuteRecord> {
    Expr.assertCode(hhmm);
    checkAbort(signal);
    if (!Object.hasOwn(this.table.minutes, hhmm))
      throw new Error(`Minute ${hhmm} is absent from the dataset`);
    if (!this.cache.has(hhmm))
      this.cache.set(
        hhmm,
        normalizeMinute({ schema: SCHEMA, hhmm, seconds: this.table.minutes[hhmm] }, hhmm),
      );
    return this.cache.get(hhmm)!;
  }
}
class FetchMinuteProvider implements FormulaProvider {
  private urlForMinute: (hhmm: string) => string | URL;
  constructor(urlForMinute: (hhmm: string) => string | URL) {
    if (typeof urlForMinute !== 'function') throw new TypeError('Expected a URL factory');
    this.urlForMinute = urlForMinute;
  }
  async getMinute(hhmm: string, { signal }: ReadOptions = {}): Promise<MinuteRecord> {
    Expr.assertCode(hhmm);
    checkAbort(signal);
    const response = await fetch(this.urlForMinute(hhmm), { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Formula data HTTP ${response.status} (${hhmm})`);
    return normalizeMinute(await response.json(), hhmm);
  }
}
// Cancel an individual reader without cancelling a download shared by other minutes.
function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    task.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
class DataHTTPError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`Formula data HTTP ${status} (${url})`);
    this.status = status;
  }
}
class StaleManifestError extends Error {}
class FetchHourProvider implements FormulaProvider {
  private fetch: typeof fetch;
  private url: string;
  private manifest: Manifest | null = null;
  private manifestTask: Promise<Manifest> | null = null;
  private hours = new Map<string, HourRecords>();
  private pending = new Map<string, Promise<HourRecords>>();
  constructor(
    manifestUrl: string | URL,
    { fetch: fetcher = (...args) => fetch(...args), initial }: FetchHourOptions = {},
  ) {
    if (typeof fetcher !== 'function') throw new TypeError('Expected a fetch function');
    this.fetch = fetcher;
    this.url = new URL(
      manifestUrl,
      typeof document === 'undefined' ? undefined : document.baseURI,
    ).href;
    // A baked snapshot serves the first request with no manifest round trip;
    // the manifest URL remains the recovery path for long-lived sessions that
    // cross a data redeploy (hour fetches then 404 and refresh the manifest).
    if (initial !== undefined) this.adopt(initial, this.url);
  }
  private adopt(raw: unknown, base: string): Manifest {
    if (
      !isRecord(raw) ||
      raw.schema !== 'formula-clock-hours/1' ||
      typeof raw.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(raw.version) ||
      !isRecord(raw.hours) ||
      Object.keys(raw.hours).length !== 24
    ) {
      throw new TypeError('Expected a versioned formula-clock-hours/1 manifest with 24 hours');
    }
    const urls: Record<string, string> = {};
    for (let i = 0; i < 24; i++) {
      const hour = String(i).padStart(2, '0');
      if (typeof raw.hours[hour] !== 'string' || !raw.hours[hour])
        throw new TypeError(`Missing hour ${hour}`);
      const url = new URL(raw.hours[hour], base);
      if (!['http:', 'https:'].includes(url.protocol))
        throw new TypeError('Hour URLs must use HTTP(S)');
      urls[hour] = url.href;
    }
    if (!this.manifest || this.manifest.version !== raw.version) {
      this.hours.clear();
      this.manifest = Object.freeze({ version: raw.version, urls: Object.freeze(urls) });
    }
    return this.manifest;
  }
  private async loadManifest(previous?: Manifest): Promise<Manifest> {
    if (this.manifest && this.manifest !== previous) return this.manifest;
    if (this.manifestTask) return this.manifestTask;
    const task = (async () => {
      const response = await this.fetch(this.url, {
        credentials: 'same-origin',
        cache: 'no-cache',
      });
      if (!response.ok) throw new DataHTTPError(response.status, this.url);
      const raw: unknown = await response.json();
      return this.adopt(raw, response.url || this.url);
    })();
    this.manifestTask = task;
    try {
      return await task;
    } finally {
      if (this.manifestTask === task) this.manifestTask = null;
    }
  }
  private async loadHour(hour: string, manifest: Manifest): Promise<HourRecords> {
    const key = `${manifest.version}/${hour}`;
    if (this.hours.has(key)) {
      const records = this.hours.get(key)!;
      this.hours.delete(key);
      this.hours.set(key, records);
      return records;
    }
    if (this.pending.has(key)) return this.pending.get(key)!;
    const task = (async () => {
      const url = manifest.urls[hour];
      const response = await this.fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new DataHTTPError(response.status, url);
      const table: unknown = await response.json();
      tableHeader(table);
      if (Object.keys(table.minutes).length !== 60)
        throw new TypeError(`Hour ${hour} must contain exactly 60 minutes`);
      const records: HourRecords = new Map();
      for (let minute = 0; minute < 60; minute++) {
        const hhmm = hour + String(minute).padStart(2, '0');
        records.set(
          hhmm,
          normalizeMinute({ schema: table.schema, hhmm, seconds: table.minutes[hhmm] }, hhmm),
        );
      }
      // A download that finishes after a manifest refresh must not refill the cache.
      if (this.manifest !== manifest)
        throw new StaleManifestError('The dataset changed during download');
      this.hours.set(key, records);
      while (this.hours.size > 2) this.hours.delete(this.hours.keys().next().value!);
      return records;
    })();
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      if (this.pending.get(key) === task) this.pending.delete(key);
    }
  }
  async getMinute(hhmm: string, { signal }: ReadOptions = {}): Promise<MinuteRecord> {
    Expr.assertCode(hhmm);
    checkAbort(signal);
    let manifest = await abortable(this.loadManifest(), signal);
    for (let attempt = 0; attempt < 2; attempt++) {
      checkAbort(signal);
      try {
        const records = await abortable(this.loadHour(hhmm.slice(0, 2), manifest), signal);
        checkAbort(signal);
        if (manifest !== this.manifest)
          throw new StaleManifestError('The dataset changed during download');
        return records.get(hhmm)!;
      } catch (error) {
        checkAbort(signal);
        if (
          attempt ||
          (!(error instanceof StaleManifestError) &&
            !(error instanceof DataHTTPError && error.status === 404))
        )
          throw error;
        const next = await abortable(this.loadManifest(manifest), signal);
        if (next.version === manifest.version) throw error;
        manifest = next;
      }
    }
    throw new Error('Formula data retries exhausted');
  }
}
// Also works for an imported file or an asynchronously fetched all-day table.
class TableProvider implements FormulaProvider {
  private loadTable: () => unknown | Promise<unknown>;
  private task: Promise<InlineProvider> | null = null;
  constructor(loadTable: () => unknown | Promise<unknown>) {
    if (typeof loadTable !== 'function') throw new TypeError('Expected an async table loader');
    this.loadTable = loadTable;
    this.task = null;
  }
  async getMinute(hhmm: string, { signal }: ReadOptions = {}): Promise<MinuteRecord> {
    Expr.assertCode(hhmm);
    checkAbort(signal);
    if (!this.task)
      this.task = Promise.resolve()
        .then(this.loadTable)
        .then((x) => new InlineProvider(x))
        .catch((error) => {
          this.task = null;
          throw error;
        });
    // One consumer cancelling must not cancel a shared all-day download.
    const provider = await this.task;
    checkAbort(signal);
    return provider.getMinute(hhmm, { signal });
  }
}
async function loadEmbedded(element: HTMLElement | null): Promise<unknown> {
  if (!element) throw new Error('Embedded formula table is missing');
  if (element.dataset.encoding !== 'gzip-base64') return JSON.parse(element.textContent || '');
  const bytes = Uint8Array.from(atob((element.textContent || '').trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}
const api = {
  SCHEMA,
  normalizeMinute,
  loadEmbedded,
  InlineProvider,
  FetchMinuteProvider,
  FetchHourProvider,
  TableProvider,
};
export {
  SCHEMA,
  normalizeMinute,
  loadEmbedded,
  InlineProvider,
  FetchMinuteProvider,
  FetchHourProvider,
  TableProvider,
};
export default Object.freeze(api);
