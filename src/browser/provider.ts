import FormulaData from '../shared/data.ts';
import hoursSnapshot from 'virtual:clock-hours';

window.FORMULA_CLOCK_CONFIG ??= {
  provider: new FormulaData.FetchHourProvider('data/manifest.json', { initial: hoursSnapshot }),
};
