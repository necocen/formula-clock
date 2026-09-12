import { test } from 'vitest';
import assert from 'node:assert/strict';
import { LinkCache } from '../../src/browser/share-client.ts';
import type { SharedSnapshot } from '../../src/shared/types.ts';
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
test('repeated saves of one snapshot share one request; accepted exact snapshots hit the cache', async () => {
  let release!: () => void;
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const cache = new LinkCache(null, async (input, init) => {
    calls.push({ input, init });
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return Response.json({ id: 'Abc0123X9z' }, { status: 202 });
  });
  const first = cache.prepare(snapshot),
    second = cache.prepare({ ...snapshot });
  assert.equal(first, second);
  assert.equal(cache.peek(snapshot), null);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, '/api/shares');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), snapshot);
  release();
  assert.equal(await first, 'Abc0123X9z');
  assert.equal(cache.peek(snapshot), 'Abc0123X9z');
  assert.ok(snapshot.ast?.op === 'mul');
  const reordered: SharedSnapshot = {
    ast: { b: snapshot.ast.b, a: snapshot.ast.a, op: 'mul' },
    division: snapshot.division,
    numerals: snapshot.numerals,
    font: snapshot.font,
    t: snapshot.t,
    v: snapshot.v,
  };
  assert.equal(cache.peek(reordered), 'Abc0123X9z');
  assert.equal(await cache.prepare(reordered), 'Abc0123X9z');
  for (const changes of [
    { t: '123422' },
    { font: 'termes' },
    { numerals: 'lining' },
    { division: 'inline' },
    { ast: null },
  ] satisfies Partial<SharedSnapshot>[])
    assert.equal(cache.peek({ ...snapshot, ...changes }), null);
  assert.equal(await cache.prepare(snapshot), 'Abc0123X9z');
  assert.equal(calls.length, 1);
  const seeded = new LinkCache({ id: 'Abc0123X9z', snapshot }, () => {
    throw Error('Unexpected save');
  });
  assert.equal(seeded.peek(snapshot), 'Abc0123X9z');
  assert.equal(await seeded.prepare(snapshot), 'Abc0123X9z');
});
test('cancelled or failed saves cannot publish stale ids and remain retryable', async () => {
  let release!: () => void;
  let signal: AbortSignal | null | undefined;
  let attempts = 0;
  const cache = new LinkCache(null, async (input, init) => {
    attempts++;
    signal = init?.signal;
    if (attempts === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return Response.json({ id: 'Abc0123X9z' });
  });
  const pending = cache.prepare(snapshot),
    rejection = assert.rejects(pending, { name: 'AbortError' });
  await Promise.resolve();
  cache.cancelPending();
  assert.ok(signal?.aborted);
  release();
  await rejection;
  assert.equal(cache.peek(snapshot), null);
  assert.equal(await cache.prepare(snapshot), 'Abc0123X9z');
  assert.equal(attempts, 2);
  for (const response of [Response.json({ id: 'invalid' }), Response.json({}, { status: 503 })]) {
    let calls = 0;
    const failed = new LinkCache(null, async () =>
      ++calls === 1 ? response : Response.json({ id: 'Abc0123X9z' }),
    );
    await assert.rejects(failed.prepare(snapshot));
    assert.equal(failed.peek(snapshot), null);
    assert.equal(await failed.prepare(snapshot), 'Abc0123X9z');
  }
});
test('the link cache bounds retained entries and aborts timed-out saves', async () => {
  let calls = 0;
  const cache = new LinkCache(null, async () =>
    Response.json({ id: String(++calls).padStart(10, '0') }),
  );
  for (let seconds = 0; seconds < 13; seconds++)
    await cache.prepare({ ...snapshot, t: '1234' + String(seconds).padStart(2, '0') });
  assert.equal(cache.peek({ ...snapshot, t: '123400' }), null);
  assert.equal(cache.peek({ ...snapshot, t: '123412' }), '0000000013');
  const hanging = new LinkCache(
    null,
    async (input, init) =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    5,
  );
  await assert.rejects(hanging.prepare(snapshot), { name: 'AbortError' });
  assert.equal(hanging.peek(snapshot), null);
});
