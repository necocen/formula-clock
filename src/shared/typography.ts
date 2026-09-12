import type { Profile } from './display.ts';
import { mark, relation } from './expression.ts';
import type { Typography } from './types.ts';

interface InkMetrics {
  top: number;
  bottom: number;
  centerY: number;
}

/** Measurements are in root SVG units (y-down, 1000 units/em). */
export async function calibrateTypography(
  profile: Omit<Profile, 'label'>,
  params: { axis_height: number },
  measure: (tex: string, marker: string) => Promise<InkMetrics>,
): Promise<Typography> {
  const zero = await measure(mark('probe', '0', profile), 'fc-probe');
  const originalAxisEm = params.axis_height;
  if (!Number.isFinite(originalAxisEm)) throw new Error('MathJax math axis is unavailable');
  const numericAxisEm = -zero.centerY / 1000;
  if (!(numericAxisEm > 0.15 && numericAxisEm < 0.55))
    throw new Error('Unexpected numeral metrics during math-axis calibration');
  // Calibrate before rendering '=': fractions, delimiters and centered signs
  // must all use the same axis. Oldstyle retains this font instance's native axis.
  if (profile.numericAxis) params.axis_height = numericAxisEm;
  const equal = await measure(relation(profile), 'fc-eq');
  return Object.freeze({
    profile: profile.id,
    numerals: profile.numerals,
    axisMode: profile.numericAxis ? 'numeric' : 'font',
    referenceDigit: '0',
    originalAxisEm,
    numericAxisEm,
    axisEm: params.axis_height,
    zeroTop: zero.top,
    zeroBottom: zero.bottom,
    equalCenterY: equal.centerY,
  });
}
