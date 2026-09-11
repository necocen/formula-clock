import { test } from 'vitest';
import assert from 'node:assert/strict';
import verify from '../helpers/verify-exact.ts';
import { validateAst } from '../../src/shared/expression.ts';
import type { Expr } from '../../src/shared/types.ts';
import { literal as L, unary as U, binary as B } from '../fixtures/ast.ts';
test('symbolic verification accepts exact extended expressions and rejects invalid intermediate domains and near misses', () => {
  const sum = B('add', B('add', L(0), L(1)), B('add', L(2), L(3)));
  const cases: [string, number, Expr, boolean][] = [
    [
      '0020',
      32,
      B('pow', U('sqrt', U('sqrt', B('add', U('fact', L(0)), U('fact', L(1))))), L(2, 4)),
      true,
    ],
    ['0452', 32, B('pow', B('add', L(0), L(1)), B('div', L(2), L(3))), true],
    ['1316', 27, B('pow', B('sub', B('add', L(0), U('sqrt', L(1))), L(2)), L(3)), true],
    ['0000', 1, B('pow', B('add', L(0), L(1)), B('add', L(2), L(3))), false],
    ['0000', 0, B('mul', L(0), B('pow', L(1), B('add', L(2), L(3)))), false],
    ['0001', 0, B('pow', B('add', L(0), L(1)), B('sub', L(2), L(3))), false],
    ['1233', 0, B('div', B('add', L(0), L(1)), B('sub', L(2), L(3))), false],
    ['1234', 0, U('sqrt', U('neg', sum)), false],
    ['1234', 0, U('fact', B('div', B('add', L(0), L(1)), B('add', L(2), L(3)))), false],
    ['1234', 0, B('pow', U('neg', B('add', L(0), L(1))), B('div', L(2), L(3))), false],
    ['1317', 0, B('pow', L(0, 2), U('neg', L(2, 4))), false],
    [
      '0020',
      31,
      B('pow', U('sqrt', U('sqrt', B('add', U('fact', L(0)), U('fact', L(1))))), L(2, 4)),
      false,
    ],
  ];
  const result = verify(
    cases.map(([code, second, ast]) => ({ code, second, ast: validateAst(ast, code) })),
  );
  assert.deepEqual(
    result.results.map((row) => row.valid),
    cases.map((row) => row[3]),
  );
});
