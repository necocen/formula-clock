import FormulaData from '../shared/data.ts';
import type { FormulaProvider, SecondEntries } from '../shared/types.ts';

export interface MinuteSolutions {
  input: string;
  solutions: SecondEntries;
  count: number;
  error?: string;
  retryAfter?: number;
}

export function assertProvider(next: FormulaProvider): void {
  if (!next || typeof next.getMinute !== 'function')
    throw new TypeError('Provider needs getMinute(hhmm, {signal})');
}

export interface DataSourceDeps {
  isCurrentCode(code: string): boolean;
  kick(): void;
}

export interface DataSource {
  readonly revision: number;
  getMinute(code: string): MinuteSolutions | undefined;
  hasMinute(code: string): boolean;
  request(code: string): void;
  replaceProvider(next: FormulaProvider): void;
}

const { normalizeMinute, TableProvider } = FormulaData;

export function createDataSource(deps: DataSourceDeps): DataSource {
  const cache = new Map<string, MinuteSolutions>(),
    pending = new Map<string, AbortController>();
  const defaultProvider = () =>
    new TableProvider(async () => {
      const embedded = document.querySelector<HTMLElement>('#clock-data');
      if (!embedded) throw new Error('No embedded formula table or custom provider');
      return FormulaData.loadEmbedded(embedded);
    });
  let provider = window.FORMULA_CLOCK_CONFIG?.provider || defaultProvider();
  let dataRevision = 0;
  function request(code: string) {
    const existing = cache.get(code);
    if (
      pending.has(code) ||
      (existing && (!existing.error || Date.now() < (existing.retryAfter || 0)))
    )
      return;
    const revision = dataRevision,
      currentProvider = provider,
      controller = new AbortController();
    pending.set(code, controller);
    Promise.resolve()
      .then(() => currentProvider.getMinute(code, { signal: controller.signal }))
      .then((raw) => {
        if (revision !== dataRevision || controller.signal.aborted) return;
        const minute = normalizeMinute(raw, code);
        cache.set(code, {
          input: code,
          solutions: minute.seconds,
          count: minute.seconds.filter(Boolean).length,
        });
      })
      .catch((error) => {
        if (revision !== dataRevision || controller.signal.aborted) return;
        console.warn('[Formula Clock] Formula data unavailable.', error);
        cache.set(code, {
          input: code,
          solutions: Array(60).fill(null),
          count: 0,
          error: String(error),
          retryAfter: Date.now() + 5000,
        });
      })
      .finally(() => {
        if (revision !== dataRevision) return;
        if (pending.get(code) === controller) pending.delete(code);
        while (cache.size > 10) cache.delete(cache.keys().next().value!);
        if (deps.isCurrentCode(code)) deps.kick();
      });
  }
  return {
    get revision() {
      return dataRevision;
    },
    getMinute: (code) => cache.get(code),
    hasMinute: (code) => cache.has(code),
    request,
    replaceProvider(next) {
      dataRevision++;
      pending.forEach((controller) => controller.abort());
      pending.clear();
      cache.clear();
      provider = next;
    },
  };
}
