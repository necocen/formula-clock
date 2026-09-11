import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { isRecord } from '../../src/shared/types.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const playwrightPackage: unknown = JSON.parse(
  fs.readFileSync(new URL('../../node_modules/playwright/package.json', import.meta.url), 'utf8'),
);
assert.ok(isRecord(playwrightPackage) && typeof playwrightPackage.version === 'string');
export const playwrightVersion = playwrightPackage.version;
export type BrowserName = 'chromium' | 'firefox' | 'webkit';
type ExtraOption =
  | 'local-mathjax'
  | 'stix-fonts'
  | 'screenshots'
  | 'symbol-motion'
  | 'structure-motion'
  | 'symbol-morph'
  | 'render-results';
interface SuiteConfig {
  browsers: readonly BrowserName[];
  standalone?: boolean;
  options?: ExtraOption[];
}
export interface BrowserOptions {
  browser: BrowserName;
  url: string;
  outputDir: string;
  localMathjax?: string;
  stixFonts?: string;
  renderResults: string;
  screenshots: boolean;
  symbolMotion: boolean;
  structureMotion: boolean;
  symbolMorph: boolean;
}

function testArguments(): string[] {
  const value: unknown = process.env.FORMULA_CLOCK_BROWSER_ARGS
    ? JSON.parse(process.env.FORMULA_CLOCK_BROWSER_ARGS)
    : process.argv.slice(2);
  assert.ok(Array.isArray(value) && value.every((arg) => typeof arg === 'string'));
  return value;
}

export function browserArgs(suiteUrl: string, config: SuiteConfig): BrowserOptions {
  const suite = path.basename(fileURLToPath(suiteUrl), '.test.ts');
  const suiteName = suite === 'stix2' ? 'compat/stix2' : suite;
  const options: Record<string, { type: 'string' | 'boolean'; short?: string }> = {
    help: { type: 'boolean', short: 'h' },
    browser: { type: 'string' },
    url: { type: 'string' },
    'output-dir': { type: 'string' },
  };
  for (const name of config.options ?? []) {
    const boolean = name === 'screenshots' || name.endsWith('-motion') || name === 'symbol-morph';
    options[name] = { type: boolean ? 'boolean' : 'string' };
    if (boolean && name !== 'screenshots') options['no-' + name] = { type: 'boolean' };
  }
  const args = testArguments();
  const { values } = parseArgs({ args, options, strict: true });
  if (values.help) {
    console.log(
      `Usage: npm run test:browser -- ${suiteName} [options]\nBrowsers: ${config.browsers.join(', ')} (default: chromium)\n\n` +
        Object.entries(options)
          .map(([name, spec]) => `  --${name}${spec.type === 'string' ? ' VALUE' : ''}`)
          .join('\n'),
    );
    process.exit(0);
  }
  const requestedBrowser = values.browser ?? 'chromium';
  const browser = config.browsers.find((name) => name === requestedBrowser);
  if (!browser) throw new Error(`Unsupported browser: ${requestedBrowser}`);
  const stringOption = (name: string): string | undefined => {
    const value = values[name];
    if (value !== undefined && typeof value !== 'string')
      throw new TypeError(`Expected --${name} VALUE`);
    return value;
  };
  let outputDir = path.resolve(
    stringOption('output-dir') ??
      path.join(
        ROOT,
        'test-results',
        config.standalone && suite === 'stix2' ? 'compat' : 'browser',
        suite,
        String(browser),
      ),
  );
  if (process.env.FORMULA_CLOCK_BROWSER_ALL === 'true' && values['output-dir']) {
    outputDir = path.join(outputDir, suite, String(browser));
  }
  fs.mkdirSync(outputDir, { recursive: true });
  return {
    browser,
    url:
      stringOption('url') ??
      (config.standalone
        ? pathToFileURL(path.join(ROOT, 'dist/standalone/index.html')).href
        : 'http://127.0.0.1:8787/'),
    outputDir,
    localMathjax: stringOption('local-mathjax'),
    stixFonts: stringOption('stix-fonts'),
    renderResults: path.resolve(
      stringOption('render-results') ?? path.join(ROOT, 'test-results/og/render-results.json'),
    ),
    screenshots: values.screenshots === true,
    symbolMotion: values['no-symbol-motion'] !== true,
    structureMotion: values['no-structure-motion'] !== true,
    symbolMorph: values['no-symbol-morph'] !== true,
  };
}

export interface BrowserReport {
  [key: string]: unknown;
  checks: unknown[];
  errors: string[];
  cases: unknown[];
}
export function createReport(initial: Partial<BrowserReport>): BrowserReport {
  return {
    checks: [],
    errors: [],
    cases: [],
    node: process.version,
    ...initial,
    arguments: testArguments(),
  };
}

export function zip<T extends readonly (readonly unknown[])[]>(
  ...arrays: T
): { [K in keyof T]: T[K][number] }[] {
  return Array.from(
    { length: Math.min(...arrays.map((array) => array.length)) },
    (_, i) => arrays.map((array) => array[i]) as { [K in keyof T]: T[K][number] },
  );
}
export function sorted<T>(
  values: Iterable<T>,
  key: (value: T) => string | number = (value) => String(value),
): T[] {
  return [...values].sort((a, b) => {
    const x = typeof a === 'number' ? a : key(a),
      y = typeof b === 'number' ? b : key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
export function combinations<T>(values: T[], count: number): T[][] {
  return count === 0
    ? [[]]
    : values.flatMap((value) => combinations(values, count - 1).map((rest) => [value, ...rest]));
}
export function factorial(value: number): number {
  let result = 1;
  for (let i = 2; i <= value; i++) result *= i;
  return result;
}
/** The license source uses these standard/numeric HTML entities. */
export function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    lt: '<',
    gt: '>',
    amp: '&',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, (_, entity: string) =>
    entity[0] === '#'
      ? String.fromCodePoint(
          parseInt(
            entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1),
            entity[1].toLowerCase() === 'x' ? 16 : 10,
          ),
        )
      : named[entity],
  );
}
