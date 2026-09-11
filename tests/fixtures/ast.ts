import assert from 'node:assert/strict';
import type { Expr } from '../../src/shared/types.ts';

type Literal = Extract<Expr, { op: 'lit' }>;
type Unary = Extract<Expr, { op: 'neg' | 'sqrt' | 'fact' }>;
type Binary = Extract<Expr, { b: Expr }>;

export function literal(i: number, j = i + 1): Literal {
  assert.ok(Number.isInteger(i) && i >= 0 && i <= 3);
  assert.ok(Number.isInteger(j) && j > i && j <= 4);
  return { op: 'lit', i: i as Literal['i'], j: j as Literal['j'] };
}
export const unary = (op: Unary['op'], a: Expr): Unary => ({ op, a });
export const binary = (op: Binary['op'], a: Expr, b: Expr): Binary => ({ op, a, b });
