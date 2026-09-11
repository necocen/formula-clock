import { isRecord, type Expr } from '../../src/shared/types.ts';
import { pythonJson } from './python.ts';

export interface VerificationRecord {
  code: string;
  second: number;
  ast: Expr | null;
}
interface VerificationResult {
  valid: boolean;
  reason: string | null;
}

export default function verifyExact(records: VerificationRecord[]): {
  sympy: string;
  results: VerificationResult[];
} {
  const report = pythonJson(new URL('./verify-exact.py', import.meta.url), records);
  if (
    !isRecord(report) ||
    typeof report.sympy !== 'string' ||
    !Array.isArray(report.results) ||
    report.results.length !== records.length
  ) {
    throw new Error('Invalid exact verification report');
  }
  const results = report.results.map((row: unknown): VerificationResult => {
    if (
      !isRecord(row) ||
      typeof row.valid !== 'boolean' ||
      !(row.reason === null || typeof row.reason === 'string')
    ) {
      throw new Error('Invalid exact verification result');
    }
    return { valid: row.valid, reason: row.reason };
  });
  return { sympy: report.sympy, results };
}
