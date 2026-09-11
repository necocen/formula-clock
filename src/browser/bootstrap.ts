import FormulaI18n from '../shared/i18n.ts';
import FormulaDisplay from '../shared/display.ts';
import FormulaShare from '../shared/share.ts';
import FormulaExpression from '../shared/expression.ts';
import FormulaData from '../shared/data.ts';
import FormulaSymbols from '../shared/symbols.ts';
import FormulaTypesetter from './typesetter.ts';
// App code imports these modules directly; the window copies are a stable
// public surface for browser tests and console debugging only.
Object.assign(window, {
  FormulaI18n,
  FormulaDisplay,
  FormulaShare,
  FormulaExpression,
  FormulaData,
  FormulaSymbols,
  FormulaTypesetter,
});
