import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { FetchHourProvider, InlineProvider } from '../../src/shared/data.ts';
const origin = 'https://clock.test/data/manifest.json';
const version = (letter: string) => letter.repeat(64);
const manifest = (letter = 'a') => ({
  schema: 'formula-clock-hours/1',
  version: version(letter),
  hours: Object.fromEntries(
    Array.from({ length: 24 }, (_, h) => {
      const hour = String(h).padStart(2, '0');
      return [hour, `hours/${hour}.${version(letter)}.json`];
    }),
  ),
});
const table = (hour: string) => ({
  schema: 'formula-clock/1',
  minutes: Object.fromEntries(
    Array.from({ length: 60 }, (_, m) => [
      hour + String(m).padStart(2, '0'),
      Array<unknown>(60).fill(null),
    ]),
  ),
});
function response(value: unknown, url: string, status = 200) {
  const result = new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
interface Call {
  url: string;
  options: RequestInit;
}
function mockHTTP(
  handler: (url: string, options: RequestInit) => Response | void | Promise<Response | void> = () =>
    undefined,
) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url: URL | RequestInfo, options: RequestInit = {}) => {
      calls.push({ url: String(url), options });
      const result = await handler(String(url), options);
      return (
        result ||
        response(
          String(url).endsWith('manifest.json')
            ? manifest()
            : table(new URL(String(url)).pathname.match(/hours\/(\d\d)/)![1]),
          String(url),
        )
      );
    },
  );
  return calls;
}
const hourCalls = (calls: Call[]) => calls.filter((x) => x.url.includes('/hours/'));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('one manifest and one hour request serve concurrent minutes, preserving null', async () => {
  const calls = mockHTTP(),
    provider = new FetchHourProvider(origin);
  const [a, b] = await Promise.all([provider.getMinute('1234'), provider.getMinute('1235')]);
  assert.equal(a.hhmm, '1234');
  assert.equal(b.hhmm, '1235');
  assert.equal(a.seconds.length, 60);
  assert.equal(a.seconds[0], null);
  assert.ok(Object.isFrozen(a.seconds));
  await provider.getMinute('1259');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.cache, 'no-cache');
});
test('hour and midnight boundaries request only the required hours', async () => {
  const calls = mockHTTP(),
    provider = new FetchHourProvider(origin);
  for (const hhmm of ['1259', '1300', '2359', '0000'])
    assert.equal((await provider.getMinute(hhmm)).hhmm, hhmm);
  assert.deepEqual(
    hourCalls(calls).map((x) => new URL(x.url).pathname.slice(12, 14)),
    ['12', '13', '23', '00'],
  );
});
test('only requested minutes are validated; malformed minutes fail on use and can retry', async () => {
  const badHour = table('12');
  badHour.minutes['1259'][0] = { op: 'lit', i: 0, j: 5 };
  let downloads = 0;
  const calls = mockHTTP((url) =>
    url.includes('/hours/') && ++downloads === 1 ? response(badHour, url) : undefined,
  );
  const provider = new FetchHourProvider(origin);
  const minute = await provider.getMinute('1200');
  assert.equal(await provider.getMinute('1200'), minute);
  assert.equal((await provider.getMinute('1230')).hhmm, '1230');
  assert.equal(hourCalls(calls).length, 1);
  await assert.rejects(provider.getMinute('1259'), TypeError);
  assert.equal((await provider.getMinute('1259')).seconds[0], null);
  assert.equal(hourCalls(calls).length, 2);
});
test('completed hour cache retains the two most recently used hours', async () => {
  const calls = mockHTTP(),
    provider = new FetchHourProvider(origin);
  for (const code of ['1200', '1300', '1259', '1400', '1201', '1301'])
    await provider.getMinute(code);
  assert.equal(hourCalls(calls).length, 4);
});
test('an aborted consumer rejects promptly while another receives the shared download', async () => {
  const started = deferred(),
    gate = deferred();
  const calls = mockHTTP(async (url) => {
    if (url.includes('/hours/')) {
      started.resolve();
      await gate.promise;
    }
  });
  const provider = new FetchHourProvider(origin),
    controller = new AbortController();
  const a = provider.getMinute('1200', { signal: controller.signal }),
    b = provider.getMinute('1201');
  const rejected = assert.rejects(a, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  await rejected;
  gate.resolve();
  assert.equal((await b).hhmm, '1201');
  assert.equal(hourCalls(calls).length, 1);
});
test('already aborted requests perform no I/O', async () => {
  const calls = mockHTTP(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new FetchHourProvider(origin).getMinute('1200', { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(calls.length, 0);
});
test('a failed manifest can be retried', async () => {
  let count = 0;
  const calls = mockHTTP((url) =>
    url === origin && ++count === 1 ? response({}, url, 503) : undefined,
  );
  const provider = new FetchHourProvider(origin);
  await assert.rejects(provider.getMinute('1200'), /503/);
  assert.equal((await provider.getMinute('1200')).hhmm, '1200');
  assert.equal(calls.length, 3);
});
test('HTTP failures are not cached and do not trigger a manifest refresh unless 404', async () => {
  let failed = false;
  const calls = mockHTTP((url) => {
    if (url.includes('/hours/') && !failed) {
      failed = true;
      return response({}, url, 500);
    }
  });
  const provider = new FetchHourProvider(origin);
  await assert.rejects(provider.getMinute('1200'), /500/);
  await provider.getMinute('1200');
  assert.equal(calls.filter((x) => x.url === origin).length, 1);
});
test('concurrent old-hour 404s share manifest refresh and retry the new version once', async () => {
  let manifestCount = 0;
  const calls = mockHTTP((url) => {
    if (url === origin) return response(manifest(++manifestCount === 1 ? 'a' : 'b'), url);
    if (url.includes(version('a'))) return response({}, url, 404);
  });
  const provider = new FetchHourProvider(origin);
  const records = await Promise.all([provider.getMinute('1200'), provider.getMinute('1300')]);
  assert.deepEqual(
    records.map((x) => x.hhmm),
    ['1200', '1300'],
  );
  assert.equal(manifestCount, 2);
  assert.equal(hourCalls(calls).length, 4);
});
test('unchanged manifest on 404 does not loop or silently turn failure into null', async () => {
  const calls = mockHTTP((url) => (url.includes('/hours/') ? response({}, url, 404) : undefined));
  await assert.rejects(new FetchHourProvider(origin).getMinute('1200'), /404/);
  assert.equal(calls.length, 3);
});
test('a second 404 after refresh is surfaced without further refresh', async () => {
  let count = 0;
  const calls = mockHTTP((url) =>
    url === origin ? response(manifest(++count === 1 ? 'a' : 'b'), url) : response({}, url, 404),
  );
  await assert.rejects(new FetchHourProvider(origin).getMinute('1200'), /404/);
  assert.equal(calls.length, 4);
  assert.equal(count, 2);
});
test('an old successful response arriving after refresh is discarded', async () => {
  const gate = deferred(),
    started = deferred();
  let count = 0;
  const calls = mockHTTP(async (url) => {
    if (url === origin) return response(manifest(++count === 1 ? 'a' : 'b'), url);
    if (url.includes(`12.${version('a')}`)) {
      started.resolve();
      await gate.promise;
      return response(table('12'), url);
    }
    if (url.includes(`13.${version('a')}`)) return response({}, url, 404);
  });
  const provider = new FetchHourProvider(origin),
    old = provider.getMinute('1200');
  await started.promise;
  await provider.getMinute('1300');
  gate.resolve();
  await old;
  assert.equal(calls.filter((x) => x.url.includes(`12.${version('b')}`)).length, 1);
});
test('hour URLs resolve against the manifest response location, allowing a future CDN move', async () => {
  const calls = mockHTTP((url) =>
    url === origin ? response(manifest(), 'https://data.test/releases/manifest.json') : undefined,
  );
  await new FetchHourProvider(origin).getMinute('1200');
  assert.ok(hourCalls(calls)[0].url.startsWith('https://data.test/releases/hours/12.'));
});
test('a manifest refreshed while a minute is resolving cannot return an old record', async () => {
  const gate = deferred(),
    started = deferred();
  let count = 0;
  const calls = mockHTTP((url) => {
    if (url === origin) return response(manifest(++count === 1 ? 'a' : 'b'), url);
    if (url.includes(`13.${version('a')}`)) return response({}, url, 404);
  });
  const getMinute = InlineProvider.prototype.getMinute;
  let delayed = false;
  vi.spyOn(InlineProvider.prototype, 'getMinute').mockImplementation(
    async function (this: InlineProvider, hhmm, options) {
      const minute = await getMinute.call(this, hhmm, options);
      if (hhmm === '1200' && !delayed) {
        delayed = true;
        started.resolve();
        await gate.promise;
      }
      return minute;
    },
  );
  const provider = new FetchHourProvider(origin),
    old = provider.getMinute('1200');
  await started.promise;
  await provider.getMinute('1300');
  gate.resolve();
  await old;
  assert.equal(calls.filter((x) => x.url.includes(`12.${version('b')}`)).length, 1);
});
test('malformed manifests and incomplete or foreign hours are rejected', async () => {
  const badManifest = manifest();
  delete badManifest.hours['23'];
  const badHour = table('12');
  delete badHour.minutes['1259'];
  const foreignHour = table('13');
  const badAst = table('12');
  badAst.minutes['1200'][0] = { op: 'lit', i: 0, j: 5 };
  for (const [m, h] of [
    [badManifest, table('12')],
    [manifest(), badHour],
    [manifest(), foreignHour],
    [manifest(), badAst],
  ]) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: URL | RequestInfo) =>
      response(String(url) === origin ? m : h, String(url)),
    );
    await assert.rejects(new FetchHourProvider(origin).getMinute('1200'), TypeError);
    vi.restoreAllMocks();
  }
});
