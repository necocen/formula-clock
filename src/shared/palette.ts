import stylesheet from './palette.css?raw';

// Read the checked-in CSS tokens through Vite's raw import, so CSS and SVG use
// one palette without generating styles or waiting for browser JavaScript.
function color(name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[\\da-f]{6})\\s*;`, 'i').exec(stylesheet)?.[1];
  if (!value) throw new Error(`Missing clock palette color: ${name}`);
  return value;
}
export const COLORS = Object.freeze({
  background: color('bg'),
  foreground: color('fg'),
  symbols: color('symbols'),
  digits: Object.freeze([color('c0'), color('c1'), color('c2'), color('c3')]),
});
