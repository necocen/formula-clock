/* Types for code that runs INSIDE the page via Playwright evaluate /
 * waitForFunction / addInitScript closures. These bare globals mirror what
 * bootstrap.ts publishes plus per-suite scratch state the probes install.
 * Application code must never reference them (AGENTS.md); they exist so test
 * probes typecheck against the real API surface.
 */
import type { FormulaClockAPI, FormulaProvider } from '../../src/shared/types.ts';

declare global {
  // Published by src/browser/bootstrap.ts and src/browser/app.ts.
  var FormulaClock: FormulaClockAPI;
  var FORMULA_CLOCK_CONFIG: { provider?: FormulaProvider };
  var FormulaShare: (typeof import('../../src/shared/share.ts'))['default'];
  var FormulaData: (typeof import('../../src/shared/data.ts'))['default'];
  var FormulaExpression: (typeof import('../../src/shared/expression.ts'))['default'];
  var FormulaTypesetter: (typeof import('../../src/browser/typesetter.ts'))['default'];

  // Per-suite scratch globals installed by probes.
  var testWall: number;
  var originalDigits: SVGGElement[];
  var originalProvider: FormulaProvider;
}

export {};
