import FormulaData from '../shared/data.ts';

if (!document.getElementById('clock-data')) {
  window.FORMULA_CLOCK_CONFIG ??= {
    provider: new FormulaData.FetchHourProvider('data/manifest.json'),
  };
}
