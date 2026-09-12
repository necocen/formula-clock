import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  SCHEMA,
  InlineProvider,
  FetchMinuteProvider,
  TableProvider,
} from '../../src/shared/data.ts';
import { normalizeMinute, validateTable } from '../../tools/validate-data.ts';
import { loadTable } from '../helpers/table.ts';
import writeReport from '../helpers/report.ts';
const table = loadTable();
test('producer validation checks and copies canonical minutes before publication', () => {
  const raw = { schema: SCHEMA, hhmm: '1234', seconds: [...table.minutes['1234']] };
  const minute = normalizeMinute(raw, '1234');
  assert.notEqual(minute.seconds, raw.seconds);
  raw.seconds[0] = null;
  assert.deepEqual(minute.seconds[0], table.minutes['1234'][0]);
  assert.ok(Object.isFrozen(minute));
  assert.ok(Object.isFrozen(minute.seconds));
  assert.ok(Object.isFrozen(minute.seconds.find(Boolean)));
  assert.throws(() => normalizeMinute(minute, '1235'), /1235/);
  const forged = Object.freeze({
    ...minute,
    seconds: Object.freeze(Array(60).fill({ op: 'lit', i: 0, j: 5 })),
  });
  assert.throws(() => normalizeMinute(forged, '1234'));
});
test('canonical minute providers preserve ASTs and handle sharing, retry and abort', async () => {
  const checks = [];
  const inline = new InlineProvider(table);
  const minute = await inline.getMinute('1234');
  assert.equal(minute.seconds.length, 60);
  assert.equal(minute.seconds, table.minutes['1234']);
  assert.equal(minute.seconds[8], table.minutes['1234'][8]);
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
  } finally {
    global.fetch = original;
  }
  checks.push('Async minute fetching keeps HTTP failures distinct from explicit null');
  for (const bad of [undefined, {}, [], { op: 'lit', i: 0, j: 5 }])
    assert.throws(() =>
      normalizeMinute({ schema: SCHEMA, hhmm: '1234', seconds: Array(60).fill(bad) }, '1234'),
    );
  checks.push('Producer validation rejects malformed trees and invalid intervals');
  const report = { build: 'r6-minimal', checks };
  console.log(report);
  writeReport('provider-results.json', report);
});

test('build validation rejects malformed tables before publication', () => {
  for (const bad of [
    null,
    {},
    { schema: SCHEMA, minutes: { '1234': Array(60) } },
    { schema: SCHEMA, minutes: { '1234': Array(60).fill({ op: 'lit', i: 0, j: 5 }) } },
  ])
    assert.throws(() => validateTable(bad));
  assert.deepEqual(validateTable(table), table);
});
