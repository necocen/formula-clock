import { shareId } from '../helpers/share-response.ts';
import type { Env, RenderInput } from '../../src/worker/types.ts';
import type { SharedSnapshot } from '../../src/shared/types.ts';
import { imageStore, shareStore } from '../helpers/bindings.ts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHandler } from '../../src/worker/handler.ts';
const snapshot: SharedSnapshot = {
  v: 1,
  t: '123421',
  font: 'stix2',
  numerals: 'oldstyle',
  division: 'fraction',
  ast: {
    op: 'mul',
    a: { op: 'add', a: { op: 'lit', i: 0, j: 1 }, b: { op: 'lit', i: 1, j: 2 } },
    b: { op: 'add', a: { op: 'lit', i: 2, j: 3 }, b: { op: 'lit', i: 3, j: 4 } },
  },
};
interface FixtureOptions {
  unbound?: boolean;
  fail?: boolean;
  failWrites?: number;
  gate?: Promise<void>;
}
function fixture(options: FixtureOptions = {}) {
  const records = new Map<string, string>(),
    images = new Map<string, Uint8Array<ArrayBuffer>>();
  const rendered: RenderInput[] = [],
    writes: unknown[][] = [],
    jobs: Promise<unknown>[] = [];
  const logs: Record<string, unknown>[] = [],
    attempts: { key: string; value: string }[] = [];
  const env: Env = {
    SHARES: options.unbound
      ? undefined
      : shareStore({
          async put(key, value, ...rest) {
            attempts.push({ key, value });
            if (options.fail || attempts.length <= (options.failWrites ?? 0))
              throw Error('KV failed');
            if (options.gate) await options.gate;
            records.set(key, value);
            writes.push(rest);
          },
          async get(key) {
            if (options.fail) throw Error('KV failed');
            return records.get(key) ?? null;
          },
        }),
    ASSETS: {
      fetch: async () => {
        throw Error('Saved shares must not fetch current formula data');
      },
    },
    OG_IMAGES: imageStore({
      get: async (key) =>
        images.has(key) ? { arrayBuffer: async () => images.get(key)!.buffer } : null,
      put: async (key, bytes) => {
        images.set(key, bytes);
      },
    }),
  };
  const handler = createHandler({
    revision: 'snapshot-test',
    timeoutMs: 100,
    renderOg: async (input) => {
      rendered.push(input);
      return new Uint8Array([137, 80, 78, 71, rendered.length]);
    },
    log: (fields) => logs.push(fields),
  });
  const request = (path: string, init?: RequestInit) =>
    handler.fetch(new Request('https://clock.example' + path, init), env, {
      waitUntil: (task) => jobs.push(task),
    });
  const create = (body: unknown = snapshot, headers: Record<string, string> = {}) =>
    request('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return {
    request,
    create,
    records,
    images,
    rendered,
    writes,
    jobs,
    logs,
    attempts,
    flush: () => Promise.all(jobs),
  };
}
test('creation returns an accepted ID before KV completes; the background snapshot never expires', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    f = fixture({ gate });
  const response = await f.create();
  assert.equal(response.status, 202);
  const id = shareId(await response.json());
  assert.match(id, /^[A-Za-z0-9]{10}$/);
  assert.equal(response.headers.get('Location'), `/s/${id}`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Server-Timing')!, /^share;dur=\d+$/);
  assert.equal(f.records.size, 0);
  // Acceptance schedules two background jobs: the KV write and the frozen image.
  assert.equal(f.jobs.length, 2);
  assert.equal(f.logs.length, 0);
  release();
  await f.flush();
  assert.deepEqual(JSON.parse(f.records.get('share/' + id)!), snapshot);
  assert.equal(f.rendered.length, 1);
  assert.ok(f.images.has(`og/shares/${id}.png`));
  assert.equal(f.logs[0].event, 'share-store');
  assert.equal(f.logs[0].status, 'ok');
  assert.equal(f.logs[0].id, id);
  assert.deepEqual(f.writes, [[]]);
  assert.equal((await f.create({ ...snapshot, id })).status, 400);
});
test('background KV failures retry the same ID and data without delaying acceptance', async () => {
  const f = fixture({ failWrites: 1 }),
    response = await f.create();
  assert.equal(response.status, 202);
  const id = shareId(await response.json());
  assert.equal(f.records.size, 0);
  await f.flush();
  assert.deepEqual(f.attempts, [
    { key: 'share/' + id, value: JSON.stringify(snapshot) },
    { key: 'share/' + id, value: JSON.stringify(snapshot) },
  ]);
  assert.deepEqual(
    f.logs.map((log) => log.status),
    ['retry', 'ok'],
  );
  assert.deepEqual(f.writes, [[]]);
});
test('separate snapshots at the same time have distinct image caches; eviction regenerates their saved ASTs', async () => {
  const f = fixture(),
    first = shareId(await (await f.create()).json()),
    second = shareId(await (await f.create({ ...snapshot, ast: null })).json());
  assert.notEqual(first, second);
  for (const id of [first, second])
    assert.equal((await f.request(`/s/${id}/og.png?t=000000`)).status, 200);
  assert.deepEqual(
    f.rendered.map((x) => x.ast),
    [snapshot.ast, null],
  );
  assert.equal(f.images.size, 2);
  assert.ok([...f.images.keys()].every((key) => key.startsWith('og/shares/')));
  await f.request(`/s/${first}/og.png`);
  assert.equal(f.rendered.length, 2);
  f.images.clear();
  await f.request(`/s/${first}/og.png`);
  assert.deepEqual(f.rendered.at(-1)!.ast, snapshot.ast);
});
test('untrusted and oversized requests never write KV; failures and missing ids are retryable', async () => {
  const f = fixture();
  assert.equal((await f.create({ ...snapshot, ast: '\\input{https://evil.example}' })).status, 400);
  assert.equal((await f.create(snapshot, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.create(snapshot, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.create(snapshot, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.create({ ...snapshot, extra: 'x'.repeat(17000) })).status, 413);
  assert.equal((await f.request('/api/shares')).status, 405);
  assert.equal(f.records.size, 0);
  const missing = await f.request('/s/Abc0123X9z');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Cache-Control'), 'no-store');
  const unbound = fixture({ unbound: true });
  assert.equal((await unbound.create()).status, 503);
  assert.equal(unbound.jobs.length, 0);
  const failed = fixture({ fail: true });
  assert.equal((await failed.create()).status, 202);
  assert.equal((await failed.request('/s/Abc0123X9z')).status, 503);
  await failed.flush();
  assert.equal(failed.records.size, 0);
  assert.equal(failed.attempts.length, 3);
  assert.deepEqual(
    failed.logs.map((log) => log.status),
    ['retry', 'retry', 'error'],
  );
});
