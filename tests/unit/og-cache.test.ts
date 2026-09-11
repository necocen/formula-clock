import type { Env } from '../../src/worker/types.ts';
import type { R2PutOptions } from '@cloudflare/workers-types';
import { imageStore } from '../helpers/bindings.ts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHandler } from '../../src/worker/handler.ts';

const stateUrl =
  'https://clock.example/og.png?v=1&t=000000&font=stix2&numerals=oldstyle&division=fraction';
const key = 'og/revision-a/000000-stix2-oldstyle-fraction.png';
const PNG = new Uint8Array([137, 80, 78, 71]);
interface FixtureOptions {
  dataError?: boolean;
  readError?: boolean;
  readHangs?: boolean;
  writeError?: boolean;
  renderError?: boolean;
  revision?: string;
  timeoutMs?: number;
}
function fixture(options: FixtureOptions = {}) {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; metadata?: R2PutOptions }>();
  const logs: Record<string, unknown>[] = [],
    jobs: Promise<unknown>[] = [];
  let renders = 0,
    assetReads = 0;
  const env: Env = {
    ASSETS: {
      async fetch(request) {
        assert.equal(new URL(request.url).origin, 'https://clock.example');
        const path = new URL(request.url).pathname;
        if (path === '/og-default.png')
          return new Response('default-png', { headers: { 'Content-Type': 'image/png' } });
        assetReads++;
        if (options.dataError) return new Response('unavailable', { status: 503 });
        if (path === '/data/manifest.json')
          return Response.json({
            schema: 'formula-clock-hours/1',
            version: 'a'.repeat(64),
            hours: Object.fromEntries(
              Array.from({ length: 24 }, (_, i) => [String(i).padStart(2, '0'), `hours/${i}.json`]),
            ),
          });
        if (path.startsWith('/data/hours/'))
          return Response.json({
            schema: 'formula-clock/1',
            minutes: Object.fromEntries(
              Array.from({ length: 60 }, (_, i) => [
                '00' + String(i).padStart(2, '0'),
                Array(60).fill(null),
              ]),
            ),
          });
        return new Response('missing', { status: 404 });
      },
    },
    OG_IMAGES: imageStore({
      async get(k) {
        if (options.readError) throw Error('R2 read failed');
        if (options.readHangs) return new Promise<never>(() => {});
        const value = objects.get(k);
        return value ? { arrayBuffer: async () => value.bytes.slice().buffer } : null;
      },
      async put(k, bytes, metadata) {
        if (options.writeError) throw Error('R2 write failed');
        objects.set(k, { bytes, metadata });
      },
    }),
  };
  const handler = createHandler({
    revision: options.revision || 'revision-a',
    timeoutMs: options.timeoutMs || 500,
    renderOg: async (input) => {
      renders++;
      assert.equal(input.ast, null);
      if (options.renderError) throw Error('render failed');
      return PNG;
    },
    log: (record) => logs.push(record),
  });
  const request = (url = stateUrl, init?: RequestInit) =>
    handler.fetch(new Request(url, init), env, { waitUntil: (task) => jobs.push(task) });
  return {
    request,
    objects,
    logs,
    env,
    get renders() {
      return renders;
    },
    get assetReads() {
      return assetReads;
    },
  };
}
test('R2 miss generates once, subsequent GET/HEAD/304 use the cached image, deletion regenerates', async () => {
  const f = fixture();
  let r = await f.request();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), PNG);
  assert.equal(f.renders, 1);
  const metadata = f.objects.get(key)?.metadata?.httpMetadata;
  assert.ok(metadata && 'contentType' in metadata);
  assert.equal(metadata.contentType, 'image/png');
  const etag = r.headers.get('ETag');
  assert.ok(etag);
  r = await f.request();
  assert.equal(f.renders, 1);
  r = await f.request(stateUrl, { method: 'HEAD' });
  assert.equal((await r.arrayBuffer()).byteLength, 0);
  assert.equal(r.headers.get('Content-Length'), '4');
  r = await f.request(stateUrl, { headers: { 'If-None-Match': etag } });
  assert.equal(r.status, 304);
  f.objects.delete(key);
  await f.request();
  assert.equal(f.renders, 2);
});
test('concurrent cache misses coalesce and query order/extras do not create another object', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 10 }, () => f.request()));
  assert.equal(f.renders, 1);
  await f.request('https://clock.example/og.png?t=000000&v=1&r=old&extra=ignored');
  assert.equal(f.renders, 1);
  assert.equal(f.objects.size, 1);
  assert.ok(f.logs.some((x) => x.cache === 'coalesced'));
});
test('a new rendering revision does not reuse the previous revision', async () => {
  const f = fixture({ revision: 'revision-b' });
  f.objects.set(key, { bytes: PNG });
  await f.request();
  assert.equal(f.renders, 1);
  assert.equal(f.objects.size, 2);
});
test('null data is a real image; missing/invalid state uses the independent default', async () => {
  const f = fixture();
  for (const url of ['https://clock.example/og.png', 'https://clock.example/og.png?t=246060']) {
    const r = await f.request(url);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'default-png');
    assert.equal(r.headers.get('Cache-Control'), 'public, max-age=60');
  }
  assert.equal(f.renders, 0);
  assert.equal(f.assetReads, 0);
  assert.equal((await f.request(stateUrl, { method: 'POST' })).status, 405);
});
test('data/render/deadline failures return the default, never persist it, and remain retryable', async () => {
  for (const options of [
    { dataError: true },
    { renderError: true },
    { readHangs: true, timeoutMs: 15 },
  ]) {
    const f = fixture(options),
      r = await f.request();
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'default-png');
    assert.equal(r.headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(f.objects.size, 0);
    assert.ok(f.logs.some((x) => x.status === 'default'));
  }
  const options = { renderError: true },
    f = fixture(options);
  await f.request();
  options.renderError = false;
  assert.deepEqual(new Uint8Array(await (await f.request()).arrayBuffer()), PNG);
  assert.equal(f.renders, 2);
});
test('R2 read/write failure still returns a successfully generated PNG', async () => {
  for (const options of [{ readError: true }, { writeError: true }]) {
    const f = fixture(options),
      r = await f.request();
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), PNG);
    assert.equal(r.headers.get('Cache-Control'), 'public, max-age=86400');
    assert.ok(f.logs.some((x) => typeof x.status === 'string' && x.status.startsWith('cache-')));
  }
});
