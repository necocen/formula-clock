import Share from '../shared/share.ts';
import type { SharedView } from '../shared/types.ts';
import type { Env, Context } from './types.ts';

export class ShareError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const MAX_BYTES = 16384;
export const shareKey = (id: string) => `share/${id}`;
export const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export async function createShare(
  request: Request,
  env: Env,
  ctx: Context,
  log: (fields: Record<string, unknown>) => void,
): Promise<Response> {
  if (!env.SHARES) throw new ShareError(503, 'share-storage-unavailable');
  const origin = request.headers.get('Origin');
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new ShareError(403, 'cross-origin-request');
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new ShareError(415, 'expected-json');
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES)
    throw new ShareError(413, 'snapshot-too-large');
  const reader = request.body?.getReader();
  if (!reader) throw new ShareError(400, 'invalid-snapshot');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        void reader.cancel();
        throw new ShareError(413, 'snapshot-too-large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let snapshot;
  try {
    snapshot = Share.snapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new ShareError(400, 'invalid-snapshot');
  }
  // 10 unbiased alphanumeric characters (~59.5 random bits). IDs are server generated,
  // never reused, and never read before writing (which would cache a KV miss).
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let id = '';
  while (id.length < 10) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      // Reject the remainder of 256 / 62 instead of biasing the first characters.
      if (byte < 248) id += alphabet[byte % 62];
      if (id.length === 10) break;
    }
  }
  const storage = env.SHARES,
    payload = JSON.stringify(snapshot),
    started = Date.now();
  // Keep the write alive after returning the ID, including when the share sheet
  // backgrounds the browser. Retries always use the same ID and immutable data.
  ctx.waitUntil(
    (async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await storage.put(shareKey(id), payload); // Deliberately no expiration.
        } catch (error) {
          log({
            id,
            status: attempt === 3 ? 'error' : 'retry',
            attempt,
            elapsedMs: Date.now() - started,
            reason: String(error instanceof Error ? error.message : error),
          });
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          continue;
        }
        log({ id, status: 'ok', attempt, elapsedMs: Date.now() - started });
        return;
      }
    })(),
  );
  return json({ id }, 202, { Location: `/s/${id}` });
}

export async function readShare(id: string, env: Env): Promise<SharedView> {
  if (!env.SHARES) throw new ShareError(503, 'share-storage-unavailable');
  const raw = await env.SHARES.get(shareKey(id), 'text');
  if (raw === null) throw new ShareError(404, 'share-not-found');
  try {
    return Share.view({ id, snapshot: JSON.parse(raw) });
  } catch {
    throw new ShareError(503, 'invalid-stored-snapshot');
  }
}
