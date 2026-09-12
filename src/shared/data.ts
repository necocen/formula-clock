import {
  isRecord,
  type FormulaProvider,
  type MinuteRecord,
  type FetchHourOptions,
  type FormulaTable,
} from './types.ts';
type ReadOptions = { signal?: AbortSignal };
interface Manifest {
  version: string;
  urls: Readonly<Record<string, string>>;
}
/* Delivery is independent of expression syntax and display options.
 * Provider contract: getMinute(hhmm, {signal}) -> Promise<MinuteRecord>.
 * All providers consume canonical data verified before publication. Callers
 * must not mutate returned ASTs; runtime delivery does not validate/copy them.
 */
import * as Expr from './expression.ts';
const SCHEMA = 'formula-clock/1';
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
class InlineProvider implements FormulaProvider {
  constructor(private table: FormulaTable) {}
  async getMinute(hhmm: string, { signal }: ReadOptions = {}): Promise<MinuteRecord> {
    Expr.assertCode(hhmm);
    checkAbort(signal);
    if (!Object.hasOwn(this.table.minutes, hhmm))
      throw new Error(`Minute ${hhmm} is absent from the dataset`);
    return { schema: SCHEMA, hhmm, seconds: this.table.minutes[hhmm] };
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
    // This endpoint supplies canonical records verified by its producer.
    return response.json() as Promise<MinuteRecord>;
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
  private hours = new Map<string, InlineProvider>();
  private pending = new Map<string, Promise<InlineProvider>>();
  constructor(
    manifestUrl: string | URL,
    { fetch: fetcher = (...args) => fetch(...args), initial }: FetchHourOptions = {},
  ) {
    if (typeof fetcher !== 'function') throw new TypeError('Expected a fetch function');
    this.fetch = fetcher;
    this.url = new URL(manifestUrl).href;
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
  private async loadHour(hour: string, manifest: Manifest): Promise<InlineProvider> {
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
      // Generated assets are validated at build time; trust their canonical ASTs.
      const table = (await response.json()) as FormulaTable;
      const records = new InlineProvider(table);
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
        const minute = await records.getMinute(hhmm, { signal });
        checkAbort(signal);
        if (manifest !== this.manifest)
          throw new StaleManifestError('The dataset changed during minute lookup');
        return minute;
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
// Load a canonical all-day table already verified by its producer.
class TableProvider implements FormulaProvider {
  private loadTable: () => FormulaTable | Promise<FormulaTable>;
  private task: Promise<InlineProvider> | null = null;
  constructor(loadTable: () => FormulaTable | Promise<FormulaTable>) {
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
const api = {
  SCHEMA,
  InlineProvider,
  FetchMinuteProvider,
  FetchHourProvider,
  TableProvider,
};
export { SCHEMA, InlineProvider, FetchMinuteProvider, FetchHourProvider, TableProvider };
export default Object.freeze(api);
