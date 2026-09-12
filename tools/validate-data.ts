// Validate canonical datasets before generation/import/build publishes them.
// Runtime providers consume this format without traversing or copying its ASTs.
import { SCHEMA } from '../src/shared/data.ts';
import { assertCode, validateAst } from '../src/shared/expression.ts';
import { isRecord, type FormulaTable, type MinuteRecord } from '../src/shared/types.ts';

export { SCHEMA };

export function normalizeMinute(record: unknown, expectedCode: string): MinuteRecord {
  assertCode(expectedCode);
  if (
    !isRecord(record) ||
    record.schema !== SCHEMA ||
    record.hhmm !== expectedCode ||
    !Array.isArray(record.seconds) ||
    record.seconds.length !== 60
  ) {
    throw new TypeError(`Expected ${SCHEMA}, hhmm=${expectedCode}, and exactly 60 second entries`);
  }
  // Array.from visits holes, so an omitted element cannot silently mean null.
  const seconds = Array.from(record.seconds, (ast) => validateAst(ast, expectedCode));
  return Object.freeze({ schema: SCHEMA, hhmm: expectedCode, seconds: Object.freeze(seconds) });
}

export function validateTable(table: unknown): FormulaTable {
  if (!isRecord(table) || table.schema !== SCHEMA || !isRecord(table.minutes))
    throw new TypeError('Invalid formula table');
  return {
    schema: SCHEMA,
    minutes: Object.fromEntries(
      Object.entries(table.minutes).map(([hhmm, seconds]) => [
        hhmm,
        normalizeMinute({ schema: SCHEMA, hhmm, seconds }, hhmm).seconds,
      ]),
    ),
  };
}
