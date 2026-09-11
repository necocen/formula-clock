import { defineConfig } from '@playwright/test';
import type { ClockTestOptions } from './tests/helpers/browser.ts';

const url = process.env.FORMULA_CLOCK_TEST_URL;

export default defineConfig<ClockTestOptions>({
  testDir: './tests/browser',
  testMatch: '*.test.ts',
  // Animation measurements must not compete for CPU across browser suites.
  workers: 1,
  fullyParallel: false,
  timeout: 900_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  outputDir: 'test-results/browser',
  reporter: [['list'], ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }]],
  metadata: { command: process.argv },
  globalSetup: './tests/helpers/setup-browser.ts',
  use: {
    baseURL: url ?? 'http://127.0.0.1:8787/',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    clockOptions: {
      url,
      renderResults: process.env.FORMULA_CLOCK_RENDER_RESULTS,
      screenshots: process.env.FORMULA_CLOCK_SCREENSHOTS === '1',
      symbolMotion: process.env.FORMULA_CLOCK_SYMBOL_MOTION !== '0',
      structureMotion: process.env.FORMULA_CLOCK_STRUCTURE_MOTION !== '0',
      symbolMorph: process.env.FORMULA_CLOCK_SYMBOL_MORPH !== '0',
    },
  },
  projects: [
    { name: 'chromium', testIgnore: 'og-snapshots.test.ts', use: { browserName: 'chromium' } },
    { name: 'webkit', testIgnore: 'og-snapshots.test.ts', use: { browserName: 'webkit' } },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
      testIgnore: [
        'og-snapshots.test.ts',
        'i18n.test.ts',
        'transport.test.ts',
        'fullscreen.test.ts',
        'speculative-share.test.ts',
      ],
    },
    {
      name: 'og-snapshots',
      testMatch: 'og-snapshots.test.ts',
      snapshotPathTemplate: '{testDir}/../fixtures/og-snapshots/{arg}{ext}',
    },
  ],
  webServer: url
    ? undefined
    : {
        command: 'pnpm run build:external && pnpm run preview:local',
        url: 'http://127.0.0.1:8787/',
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
