import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { test as base } from '@playwright/test';
import { isRecord } from '../../src/shared/types.ts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const playwrightPackage: unknown = createRequire(import.meta.url)('@playwright/test/package.json');
assert.ok(isRecord(playwrightPackage) && typeof playwrightPackage.version === 'string');
export const playwrightVersion = playwrightPackage.version;
export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export interface ClockOptions {
  url?: string;
  renderResults?: string;
  screenshots: boolean;
  symbolMotion: boolean;
  structureMotion: boolean;
  symbolMorph: boolean;
}
export interface ClockTestOptions {
  clockOptions: ClockOptions;
}
export interface BrowserOptions extends ClockOptions {
  browser: BrowserName;
  url: string;
  outputDir: string;
}
export const test = base.extend<
  ClockTestOptions & { args: BrowserOptions; isolatedContexts: void }
>({
  clockOptions: [
    { screenshots: false, symbolMotion: true, structureMotion: true, symbolMorph: true },
    { option: true },
  ],
  // Some suites open extra contexts to check locale, timezone, and saved preferences.
  // Built-in page/context fixtures close themselves; this also closes those extras on failure.
  isolatedContexts: [
    async ({ browser }, use) => {
      await use();
      await Promise.all(browser.contexts().map((context) => context.close()));
    },
    { auto: true, box: true },
  ],
  args: async ({ browserName, baseURL, clockOptions }, use, testInfo) => {
    const outputDir = testInfo.outputPath();
    fs.mkdirSync(outputDir, { recursive: true });
    await use({
      ...clockOptions,
      browser: browserName,
      url: clockOptions.url ?? baseURL!,
      outputDir,
      renderResults: clockOptions.renderResults
        ? path.resolve(clockOptions.renderResults)
        : undefined,
    });
  },
});

test.afterEach(async ({ args }, testInfo) => {
  for (const name of fs.readdirSync(args.outputDir).filter((file) => file.endsWith('.json')))
    await testInfo.attach(name, {
      path: path.join(args.outputDir, name),
      contentType: 'application/json',
    });
});

export interface BrowserReport {
  [key: string]: unknown;
  checks: unknown[];
  errors: string[];
  cases: unknown[];
}
export function createReport(initial: Partial<BrowserReport>): BrowserReport {
  const info = base.info();
  return {
    checks: [],
    errors: [],
    cases: [],
    node: process.version,
    ...initial,
    command: info.config.metadata.command,
    project: info.project.name,
    options: info.project.use,
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
