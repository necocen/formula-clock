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
  const api = {SCHEMA,normalizeMinute,loadEmbedded,InlineProvider,FetchMinuteProvider,TableProvider};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.FormulaData=Object.freeze(api);
})(typeof window === 'undefined' ? globalThis : window);
