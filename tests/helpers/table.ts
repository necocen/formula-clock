import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeMinute, SCHEMA } from '../../src/shared/data.ts';
import { isRecord, type FormulaTable } from '../../src/shared/types.ts';

export function loadTable(): FormulaTable {
  const raw: unknown = JSON.parse(
    fs.readFileSync(new URL('../../data/expressions.json', import.meta.url), 'utf8'),
  );
  assert.ok(isRecord(raw) && raw.schema === SCHEMA && isRecord(raw.minutes));
  return {
    schema: SCHEMA,
    minutes: Object.fromEntries(
      Object.entries(raw.minutes).map(([hhmm, seconds]) => [
        hhmm,
        normalizeMinute({ schema: SCHEMA, hhmm, seconds }, hhmm).seconds,
      ]),
    ),
  };
}
