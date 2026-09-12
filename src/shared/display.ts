import { isRecord, type Bounds, type DisplayOptions } from './types.ts';
/* Typography choices shared by the interactive clock and the OG renderer. */
const PROFILES = Object.freeze({
  stix2: Object.freeze({
    id: 'stix2' as const,
    label: 'STIX Two',
  }),
  termes: Object.freeze({
    id: 'termes' as const,
    label: 'Termes',
  }),
  fira: Object.freeze({
    id: 'fira' as const,
    label: 'Fira',
  }),
  euler: Object.freeze({
    id: 'euler' as const,
    label: 'Euler',
  }),
});
const NUMERALS = Object.freeze({ lining: 'Lining', oldstyle: 'Oldstyle' });
const DEFAULTS = Object.freeze({
  font: 'stix2',
  numerals: 'oldstyle',
  division: 'fraction',
  symbolMotion: true,
  structureMotion: true,
  symbolMorph: true,
} as const satisfies DisplayOptions);
function isFont(value: unknown): value is DisplayOptions['font'] {
  return typeof value === 'string' && Object.hasOwn(PROFILES, value);
}
function isNumerals(value: unknown): value is DisplayOptions['numerals'] {
  return typeof value === 'string' && Object.hasOwn(NUMERALS, value);
}
function isDivision(value: unknown): value is DisplayOptions['division'] {
  return value === 'fraction' || value === 'inline' || value === 'slash';
}
function isDisplay(value: unknown): value is DisplayOptions {
  return (
    isRecord(value) &&
    isFont(value.font) &&
    isNumerals(value.numerals) &&
    isDivision(value.division) &&
    (['symbolMotion', 'structureMotion', 'symbolMorph'] as const).every(
      (key) => typeof value[key] === 'boolean',
    )
  );
}
/** Selected preferences are preserved; only rendering masks dependent motions. */
function activeDisplay(options: DisplayOptions): DisplayOptions {
  return {
    ...options,
    structureMotion: options.symbolMotion && options.structureMotion,
    symbolMorph: options.symbolMotion && options.symbolMorph,
  };
}
function typography(font: DisplayOptions['font'], numerals: DisplayOptions['numerals']) {
  if (!isFont(font) || !isNumerals(numerals)) throw new TypeError('Invalid typography');
  return Object.freeze({
    ...PROFILES[font],
    numerals,
    oldstyle: numerals === 'oldstyle',
    centerOperators: numerals === 'lining',
    numericAxis: numerals === 'lining',
  });
}
function fitFrame(bounds: Bounds, axisY: number, width: number, height: number, maxFontSize = 112) {
  const axis = height / 2,
    margin = 15;
  const above = Math.max(1, axisY - bounds.y),
    below = Math.max(1, bounds.y + bounds.h - axisY);
  const scale = Math.min(
    maxFontSize / 1000,
    (width - 24) / bounds.w,
    (axis - margin) / above,
    (height - margin - axis) / below,
  );
  return {
    scale,
    x: (width - bounds.w * scale) / 2 - bounds.x * scale,
    y: axis - axisY * scale,
    axis,
  };
}
const api = {
  PROFILES,
  NUMERALS,
  DEFAULTS,
  isFont,
  isNumerals,
  isDivision,
  isDisplay,
  activeDisplay,
  typography,
  fitFrame,
};
export {
  PROFILES,
  NUMERALS,
  DEFAULTS,
  isFont,
  isNumerals,
  isDivision,
  isDisplay,
  activeDisplay,
  typography,
  fitFrame,
};
export default Object.freeze(api);
export type Profile = ReturnType<typeof typography>;
