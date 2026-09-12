import assert from 'node:assert/strict';
import { test } from 'vitest';
import { typography } from '../../src/shared/display.ts';
import { calibrateTypography } from '../../src/shared/typography.ts';

test('lining calibrates before measuring equality while oldstyle preserves its native axis', async () => {
  // Run both styles together with separate engine parameters. The equality's
  // visible ink is deliberately offset from its mathematical metric center.
  const results = await Promise.all(
    (['lining', 'oldstyle'] as const).map(async (numerals) => {
      const params = { axis_height: 0.25 };
      const probes: [string, number][] = [];
      const result = await calibrateTypography(
        typography('stix2', numerals),
        params,
        async (tex, marker) => {
          probes.push([marker, params.axis_height]);
          assert.ok(tex.includes(marker));
          if (marker === 'fc-probe') return { top: -700, bottom: 0, centerY: -350 };
          const centerY = -params.axis_height * 1000 + 0.125;
          return { top: centerY - 70, bottom: centerY + 70, centerY };
        },
      );
      const axis = numerals === 'lining' ? 0.35 : 0.25;
      assert.deepEqual(probes, [
        ['fc-probe', 0.25],
        ['fc-eq', axis],
      ]);
      assert.equal(params.axis_height, axis);
      assert.equal(result.originalAxisEm, 0.25);
      assert.equal(result.numericAxisEm, 0.35);
      assert.equal(result.axisEm, axis);
      assert.equal(result.equalCenterY, -axis * 1000 + 0.125);
      assert.equal(result.zeroTop, -700);
      assert.equal(result.zeroBottom, 0);
      return result;
    }),
  );
  assert.deepEqual(
    results.map((result) => result.axisMode),
    ['numeric', 'font'],
  );
});

test('invalid numeral metrics cannot modify an engine axis or start the equality probe', async () => {
  for (const centerY of [NaN, -100, -600]) {
    const params = { axis_height: 0.25 };
    await assert.rejects(
      calibrateTypography(typography('fira', 'lining'), params, async (_tex, marker) => {
        assert.equal(marker, 'fc-probe');
        return { top: centerY - 100, bottom: centerY + 100, centerY };
      }),
      /numeral metrics/,
    );
    assert.equal(params.axis_height, 0.25);
  }
});
