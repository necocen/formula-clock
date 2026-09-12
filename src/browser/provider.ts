import FormulaData from '../shared/data.ts';

window.FORMULA_CLOCK_CONFIG ??= {
  provider: new FormulaData.FetchHourProvider('data/manifest.json'),
};
