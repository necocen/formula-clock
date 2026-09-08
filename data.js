/* Delivery is independent of expression syntax and display options.
 * Provider contract: getMinute(hhmm, {signal}) -> Promise<MinuteRecord>.
 */
(function (root) {
  'use strict';
  const Expr = typeof module !== 'undefined' && module.exports ? require('./expression.js') : root.FormulaExpression;
  const SCHEMA = 'formula-clock/1';
  function checkAbort(signal) { if (signal?.aborted) throw new DOMException('Aborted','AbortError'); }
  function normalizeMinute(record, expectedCode) {
    Expr.assertCode(expectedCode);
    if (!record || record.schema !== SCHEMA || record.hhmm !== expectedCode || !Array.isArray(record.seconds) || record.seconds.length !== 60) {
      throw new TypeError(`Expected ${SCHEMA}, hhmm=${expectedCode}, and exactly 60 second entries`);
    }
    // Array.from visits holes, so an omitted element cannot silently mean null.
    const seconds = Array.from(record.seconds, ast => Expr.validateAst(ast,expectedCode));
    return Object.freeze({ schema:SCHEMA, hhmm:expectedCode, seconds:Object.freeze(seconds) });
  }
  function tableHeader(table) {
    if (!table || table.schema !== SCHEMA || !table.minutes || typeof table.minutes !== 'object' || Array.isArray(table.minutes)) {
      throw new TypeError('Invalid formula table');
    }
    Object.keys(table.minutes).forEach(Expr.assertCode);
  }
  class InlineProvider {
    constructor(table) { tableHeader(table); this.table = table; this.cache = new Map(); }
    async getMinute(hhmm, {signal} = {}) {
      Expr.assertCode(hhmm); checkAbort(signal);
      if (!Object.hasOwn(this.table.minutes,hhmm)) throw new Error(`Minute ${hhmm} is absent from the dataset`);
      if (!this.cache.has(hhmm)) this.cache.set(hhmm,normalizeMinute({schema:SCHEMA,hhmm,seconds:this.table.minutes[hhmm]},hhmm));
      return this.cache.get(hhmm);
    }
  }
  class FetchMinuteProvider {
    constructor(urlForMinute) {
      if (typeof urlForMinute !== 'function') throw new TypeError('Expected a URL factory');
      this.urlForMinute = urlForMinute;
    }
    async getMinute(hhmm, {signal} = {}) {
      Expr.assertCode(hhmm); checkAbort(signal);
      const response = await fetch(this.urlForMinute(hhmm), {signal, credentials:'same-origin'});
      if (!response.ok) throw new Error(`Formula data HTTP ${response.status} (${hhmm})`);
      return normalizeMinute(await response.json(),hhmm);
    }
  }
  // Cancel an individual reader without cancelling a download shared by other minutes.
  function abortable(task, signal) {
    if (!signal) return task;
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DOMException('Aborted','AbortError')); };
      const cleanup = () => signal.removeEventListener('abort',abort);
      signal.addEventListener('abort',abort,{once:true});
      task.then(value => { cleanup(); resolve(value); },error => { cleanup(); reject(error); });
    });
  }
  class DataHTTPError extends Error {
    constructor(status, url) { super(`Formula data HTTP ${status} (${url})`); this.status=status; }
  }
  class StaleManifestError extends Error {}
  class FetchHourProvider {
    constructor(manifestUrl) {
      this.url = new URL(manifestUrl,root.document?.baseURI).href;
      this.manifest = null;
      this.manifestTask = null;
      this.hours = new Map();
      this.pending = new Map();
    }
    async loadManifest(previous) {
      if (this.manifest && this.manifest !== previous) return this.manifest;
      if (this.manifestTask) return this.manifestTask;
      const task = (async () => {
        const response = await fetch(this.url,{credentials:'same-origin',cache:'no-cache'});
        if (!response.ok) throw new DataHTTPError(response.status,this.url);
        const raw = await response.json();
        if (raw?.schema !== 'formula-clock-hours/1' || !/^[a-f0-9]{64}$/.test(raw.version) ||
            !raw.hours || typeof raw.hours !== 'object' || Array.isArray(raw.hours) || Object.keys(raw.hours).length !== 24) {
          throw new TypeError('Expected a versioned formula-clock-hours/1 manifest with 24 hours');
        }
        const urls = {};
        for (let i=0;i<24;i++) {
          const hour = String(i).padStart(2,'0');
          if (typeof raw.hours[hour] !== 'string' || !raw.hours[hour]) throw new TypeError(`Missing hour ${hour}`);
          const url = new URL(raw.hours[hour],response.url || this.url);
          if (!['http:','https:'].includes(url.protocol)) throw new TypeError('Hour URLs must use HTTP(S)');
          urls[hour] = url.href;
        }
        if (!this.manifest || this.manifest.version !== raw.version) {
          this.hours.clear();
          this.manifest = Object.freeze({version:raw.version,urls:Object.freeze(urls)});
        }
        return this.manifest;
      })();
      this.manifestTask = task;
      try { return await task; }
      finally { if (this.manifestTask === task) this.manifestTask = null; }
    }
    async loadHour(hour, manifest) {
      const key = `${manifest.version}/${hour}`;
      if (this.hours.has(key)) {
        const records = this.hours.get(key);
        this.hours.delete(key); this.hours.set(key,records);
        return records;
      }
      if (this.pending.has(key)) return this.pending.get(key);
      const task = (async () => {
        const url = manifest.urls[hour];
        const response = await fetch(url,{credentials:'same-origin'});
        if (!response.ok) throw new DataHTTPError(response.status,url);
        const table = await response.json();
        tableHeader(table);
        if (Object.keys(table.minutes).length !== 60) throw new TypeError(`Hour ${hour} must contain exactly 60 minutes`);
        const records = new Map();
        for (let minute=0;minute<60;minute++) {
          const hhmm = hour + String(minute).padStart(2,'0');
          records.set(hhmm,normalizeMinute({schema:table.schema,hhmm,seconds:table.minutes[hhmm]},hhmm));
        }
        // A download that finishes after a manifest refresh must not refill the cache.
        if (this.manifest !== manifest) throw new StaleManifestError('The dataset changed during download');
        this.hours.set(key,records);
        while (this.hours.size > 2) this.hours.delete(this.hours.keys().next().value);
        return records;
      })();
      this.pending.set(key,task);
      try { return await task; }
      finally { if (this.pending.get(key) === task) this.pending.delete(key); }
    }
    async getMinute(hhmm, {signal} = {}) {
      Expr.assertCode(hhmm); checkAbort(signal);
      let manifest = await abortable(this.loadManifest(),signal);
      for (let attempt=0;attempt<2;attempt++) {
        checkAbort(signal);
        try {
          const records = await abortable(this.loadHour(hhmm.slice(0,2),manifest),signal);
          checkAbort(signal);
          if (manifest !== this.manifest) throw new StaleManifestError('The dataset changed during download');
          return records.get(hhmm);
        } catch (error) {
          checkAbort(signal);
          if (attempt || (!(error instanceof StaleManifestError) && error.status !== 404)) throw error;
          const next = await abortable(this.loadManifest(manifest),signal);
          if (next.version === manifest.version) throw error;
          manifest = next;
        }
      }
    }
  }
  // Also works for an imported file or an asynchronously fetched all-day table.
  class TableProvider {
    constructor(loadTable) {
      if (typeof loadTable !== 'function') throw new TypeError('Expected an async table loader');
      this.loadTable = loadTable; this.task = null;
    }
    async getMinute(hhmm, {signal} = {}) {
      Expr.assertCode(hhmm); checkAbort(signal);
      if (!this.task) this.task = Promise.resolve().then(this.loadTable).then(x => new InlineProvider(x)).catch(error => {this.task=null; throw error;});
      // One consumer cancelling must not cancel a shared all-day download.
      const provider = await this.task; checkAbort(signal);
      return provider.getMinute(hhmm,{signal});
    }
  }
  async function loadEmbedded(element) {
    if (!element) throw new Error('Embedded formula table is missing');
    if (element.dataset.encoding !== 'gzip-base64') return JSON.parse(element.textContent);
    const bytes = Uint8Array.from(atob(element.textContent.trim()), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }
  const api = {SCHEMA,normalizeMinute,loadEmbedded,InlineProvider,FetchMinuteProvider,FetchHourProvider,TableProvider};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.FormulaData=Object.freeze(api);
})(typeof window === 'undefined' ? globalThis : window);
