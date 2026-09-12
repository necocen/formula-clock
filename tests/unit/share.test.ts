import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as Share from '../../src/shared/share.ts';
import { plain, compact } from '../../src/shared/expression.ts';
import type { Expr, SharedSnapshot, SharedClockState } from '../../src/shared/types.ts';
import { literal as L, unary as U, binary as B } from '../fixtures/ast.ts';
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
test('share titles use the saved expression with slash division and caret powers', () => {
  const state = Share.snapshot({
    ...snapshot,
    t: '123405',
    ast: B('add', L(0), B('div', B('pow', L(1), L(2)), { op: 'sqrt', a: L(3) })),
  });
  assert.equal(Share.title(state), '1 + 2^3 / √4 = 5');
  assert.equal(Share.title({ ...state, division: 'inline' }), Share.title(state));
  assert.equal(Share.title(snapshot), '(1 + 2) × (3 + 4) = 21');
  assert.equal(Share.title({ ...state, ast: null }), 'Formula Clock — 12:34:05');
  assert.equal(Share.title(null), 'Formula Clock');
  assert.equal(plain(state.ast!, '1234'), '1 + 2^3 ÷ √4');
});
test('link cards use time titles and compact expressions with grouping preserved', () => {
  const example = Share.snapshot({
    ...snapshot,
    t: '235044',
    ast: B('add', U('neg', B('mul', L(0), L(1))), L(2, 4)),
  });
  assert.deepEqual(Share.card(example), {
    title: 'Formula Clock - 23:50:44',
    description: '-(2×3)+50=44',
  });
  assert.deepEqual(Share.card({ ...example, ast: null }), {
    title: 'Formula Clock - 23:50:44',
    description: '23:50:44',
  });
  assert.deepEqual(Share.card(null), { title: 'Formula Clock', description: null });
  for (const [ast, text] of [
    [B('add', L(0), B('div', B('pow', L(1), L(2)), U('sqrt', L(3)))), '1+2^3/√4'],
    [B('div', L(0), B('div', L(1), B('add', L(2), L(3)))), '1/(2/(3+4))'],
    [B('sub', L(0), B('add', L(1), B('mul', L(2), L(3)))), '1-(2+3×4)'],
    [B('pow', B('pow', L(0), L(1)), B('add', L(2), L(3))), '(1^2)^(3+4)'],
    [B('pow', L(0), B('pow', L(1), B('add', L(2), L(3)))), '1^2^(3+4)'],
    [B('add', B('pow', U('neg', L(0)), L(1)), B('mul', L(2), L(3))), '(-1)^2+3×4'],
    [B('add', U('fact', U('fact', L(0))), B('mul', L(1), B('add', L(2), L(3)))), '(1!)!+2×(3+4)'],
    [B('add', U('fact', L(0)), B('mul', L(1), B('mul', L(2), L(3)))), '1!+2×3×4'],
    [B('add', L(0), B('add', L(1), B('add', L(2), L(3)))), '1+2+3+4'],
    [B('mul', L(0), B('div', L(1), B('mul', L(2), L(3)))), '1×(2/(3×4))'],
    [B('add', B('pow', U('sqrt', L(0)), L(1)), B('pow', L(2), U('neg', L(3)))), '(√1)^2+3^-4'],
    [B('add', U('sqrt', B('pow', L(0), L(1))), B('pow', L(2), L(3))), '√(1^2)+3^4'],
    [B('add', U('fact', U('sqrt', L(0))), B('mul', L(1), B('mul', L(2), L(3)))), '(√1)!+2×3×4'],
    [B('add', U('sqrt', U('fact', L(0))), B('mul', L(1), B('mul', L(2), L(3)))), '√(1!)+2×3×4'],
  ] satisfies [Expr, string][])
    assert.equal(compact(ast, '1234'), text);
});
test('snapshots preserve bounded ASTs and explicit null; reject extra fields and malformed trees', () => {
  const saved = Share.snapshot(snapshot);
  assert.deepEqual(saved, snapshot);
  assert.notEqual(saved.ast, snapshot.ast);
  assert.ok(Object.isFrozen(saved) && Object.isFrozen(saved.ast));
  assert.equal(Share.snapshot({ ...snapshot, ast: null }).ast, null);
  for (const value of [
    null,
    {},
    { ...snapshot, ast: undefined },
    { ...snapshot, ast: 'x' },
    { ...snapshot, url: 'https://evil.example' },
    { ...snapshot, ast: { op: 'lit', i: 0, j: 1 } },
    { ...snapshot, ast: { ...snapshot.ast, tex: 'danger' } },
    { ...snapshot, font: 'unknown' },
  ])
    assert.throws(() => Share.snapshot(value));
  const id = 'Abc0123X9z',
    url = Share.shortUrl('https://clock.example/old?old=1#old', id);
  assert.equal(url.href, `https://clock.example/s/${id}`);
  assert.equal(Share.id(url.pathname), id);
  for (const path of [
    '/s/x',
    '/s/Abc0123_-x',
    '/s/' + id + '/',
    '/s/' + id + '/og.png',
    '/s/../../etc',
    '/s/' + id + '?x',
  ])
    assert.equal(Share.id(path), null);
  assert.throws(() => Share.shortUrl(url.origin, '../../x'));
  assert.deepEqual(Share.view({ id, snapshot }), { id, snapshot });
});

test('every supported display choice and boundary time round-trips canonically', () => {
  for (const t of ['000000', '000059', '005959', '120000', '235959'])
    for (const font of ['stix2', 'termes', 'fira', 'euler'] as const)
      for (const numerals of ['lining', 'oldstyle'] as const)
        for (const division of ['fraction', 'inline', 'slash'] as const) {
          const state: SharedClockState = { v: 1, t, font, numerals, division },
            url = Share.url('https://clock.example/ignored?old=1#fragment', state);
          assert.equal(url.pathname, '/');
          assert.equal(url.hash, '');
          assert.deepEqual(Share.parse(url), state);
          assert.deepEqual(Share.snapshot({ ...state, ast: snapshot.ast }), {
            ...state,
            ast: snapshot.ast,
          });
          assert.equal(
            url.search,
            `?v=1&t=${t}&font=${font}&numerals=${numerals}&division=${division}`,
          );
        }
});
test('defaults are independent of local preferences; invalid time/version is not a shared state', () => {
  assert.deepEqual(
    Share.parse('https://clock.example/?t=123430&font=nope&numerals=bad&division=bad&extra=secret'),
    { v: 1, t: '123430', font: 'stix2', numerals: 'oldstyle', division: 'fraction' },
  );
  for (const query of [
    '',
    't=240000',
    't=126000',
    't=120060',
    't=12345',
    't=１２３４３０',
    't=12:34:30',
    't=123430&v=2',
    't=123430&v=',
  ])
    assert.equal(Share.parse(`https://clock.example/?${query}`), null, query);
  assert.throws(
    () => Share.params({ v: 1, t: '123430', font: '../../escape' } as unknown as SharedClockState),
    /Invalid/,
  );
  assert.equal(
    Share.title(Share.parse('https://clock.example/?t=235334')),
    'Formula Clock — 23:53:34',
  );
});
test('shared readings do not shift with recipient timezone or DST', () => {
  const source = `import * as s from './src/shared/share.ts';for(const t of ['000000','023000','123430','235959']){const d=s.localDate(t);if([d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join('')!==t)throw Error(t);}`;
  for (const TZ of ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/London', 'Pacific/Apia'])
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, TZ },
    });
});
