import { isRecord, type SharedSnapshot, type SharedView } from '../shared/types.ts';
import { isShareId } from '../shared/share.ts';

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
export class LinkCache {
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
          if (!isRecord(result) || !isShareId(result.id)) throw new Error('Invalid share response');
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
