import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  SCHEMA,
  InlineProvider,
  FetchMinuteProvider,
  TableProvider,
  normalizeMinute,
} from '../../src/shared/data.ts';
import { loadTable } from '../helpers/table.ts';
import writeReport from '../helpers/report.ts';
const table = loadTable();
test('minute providers validate data and handle sharing, retry and abort', async () => {
  const checks = [];
  const inline = new InlineProvider(table);
  const minute = await inline.getMinute('1234');
  assert.equal(minute.seconds.length, 60);
  assert.ok(Object.isFrozen(minute.seconds));
  assert.deepEqual(minute.seconds[8], table.minutes['1234'][8]);
  const missing = new InlineProvider({ schema: SCHEMA, minutes: { 1234: Array(60).fill(null) } });
  await assert.rejects(missing.getMinute('0000'), /absent/);
  assert.equal((await missing.getMinute('1234')).seconds[0], null);
  checks.push('Missing minute is an error; explicit null is an ordinary-clock instruction');
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(inline.getMinute('1234', { signal: ac.signal }), { name: 'AbortError' });
  let called = 0;
  const shared = new TableProvider(async () => {
    called++;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return table;
  });
  await Promise.all([shared.getMinute('1234'), shared.getMinute('0000')]);
  assert.equal(called, 1);
  let tries = 0;
  const retry = new TableProvider(async () => {
    if (++tries === 1) throw Error('temporary');
    return table;
  });
  await assert.rejects(retry.getMinute('1234'));
  await retry.getMinute('1234');
  assert.equal(tries, 2);
  checks.push('One async all-day load is shared; failed load retries; abort is respected');
  const original = global.fetch;
  let seen: { url: URL | RequestInfo; options?: RequestInit } | undefined;
  try {
    global.fetch = async (url, options) => {
      seen = { url, options };
      return Response.json(minute);
    };
    const fetcher = new FetchMinuteProvider((hhmm) => `https://example.test/${hhmm}.json`);
    assert.equal((await fetcher.getMinute('1234')).hhmm, '1234');
    assert.ok(seen);
    assert.equal(seen.url, 'https://example.test/1234.json');
    global.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(fetcher.getMinute('1234'), /404/);
    global.fetch = async () => Response.json({ ...minute, hhmm: '1235' });
    await assert.rejects(fetcher.getMinute('1234'), /1234/);
  } finally {
    global.fetch = original;
  }
  checks.push('Async minute fetching checks HTTP status and HHMM identity');
  for (const bad of [undefined, {}, [], { op: 'lit', i: 0, j: 5 }])
    assert.throws(() =>
      normalizeMinute({ schema: SCHEMA, hhmm: '1234', seconds: Array(60).fill(bad) }, '1234'),
    );
  checks.push('Malformed trees, absent second entries and invalid intervals are rejected');
  const report = { build: 'r6-minimal', checks };
  console.log(report);
  writeReport('provider-results.json', report);
});
