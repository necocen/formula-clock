import fs from 'node:fs';
import { validateTable } from '../../tools/validate-data.ts';
import type { FormulaTable } from '../../src/shared/types.ts';

export function loadTable(): FormulaTable {
  const raw: unknown = JSON.parse(
    fs.readFileSync(new URL('../../data/expressions.json', import.meta.url), 'utf8'),
  );
  return validateTable(raw);
}
