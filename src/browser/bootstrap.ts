import FormulaI18n from './i18n.ts';
import FormulaDisplay from '../shared/display.ts';
import Share from '../shared/share.ts';
import { LinkCache } from './share-client.ts';
import FormulaExpression from '../shared/expression.ts';
import FormulaData from './data.ts';
import FormulaSymbols from '../shared/symbols.ts';
import FormulaTypesetter from './typesetter.ts';
const FormulaShare = Object.freeze({ ...Share, LinkCache });
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
