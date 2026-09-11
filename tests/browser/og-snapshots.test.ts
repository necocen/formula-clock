import { test, expect } from '@playwright/test';

// Golden PNGs came from the accepted renderer before the build/asset migration.
// Compare actual workerd responses independently of the current renderer used
// by the detailed browser/OG geometry parity test.
for (const font of ['stix2', 'termes', 'fira', 'euler']) {
  for (const numerals of ['oldstyle', 'lining']) {
    for (const sample of [
      { t: '235910', label: 'fraction' },
      { t: '123459', label: 'exponent-factorial' },
      { t: '004159', label: 'ordinary-clock' },
    ]) {
      test(`${font}-${numerals}-${sample.label}`, async ({ request }) => {
        const response = await request.get('/og.png', {
          params: { t: sample.t, font, numerals, division: 'fraction' },
        });
        expect(response.ok()).toBe(true);
        expect(response.headers()['cache-control']).toBe('public, max-age=86400');
        expect(await response.body()).toMatchSnapshot(
          `${font}-${numerals}-fraction-${sample.label}.png`,
          { threshold: 0, maxDiffPixels: 0 },
        );
      });
    }
  }
}

for (const division of ['inline', 'slash']) {
  test(`division-${division}`, async ({ request }) => {
    const response = await request.get('/og.png', {
      params: { t: '102430', font: 'stix2', numerals: 'oldstyle', division },
    });
    expect(response.ok()).toBe(true);
    expect(response.headers()['cache-control']).toBe('public, max-age=86400');
    expect(await response.body()).toMatchSnapshot(
      `stix2-oldstyle-${division}-nested-fraction-factorial.png`,
      { threshold: 0, maxDiffPixels: 0 },
    );
  });
}

test('default-logo', async ({ request }) => {
  const response = await request.get('/og.png');
  expect(response.headers()['cache-control']).toBe('public, max-age=60');
  expect(await response.body()).toMatchSnapshot('default.png', { threshold: 0, maxDiffPixels: 0 });
});
