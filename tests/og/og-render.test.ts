import type { SharedClockState } from '../../src/shared/types.ts';
import { loadTable } from '../helpers/table.ts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRenderer, renderSvg } from '../../src/worker/render.ts';
import { renderOgReference } from '../helpers/og-reference.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(root, process.env.OG_TEST_OUTPUT || 'test-results/og');
const table = loadTable();
await initRenderer(
  await fs.readFile(path.join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
);
test('all four fonts and independent styles render complete, bounded OG images', async () => {
  await renderOgReference(output);
});
test('concurrent requests cannot mix lining calibration, fonts, or expressions', async () => {
  const inputs = Array.from({ length: 16 }, (_, i): { state: SharedClockState } => ({
    state: {
      v: 1,
      t: i % 2 ? '163919' : '123430',
      font: (['stix2', 'termes', 'fira', 'euler'] as const)[i % 4],
      numerals: i % 2 ? 'lining' : 'oldstyle',
      division: 'fraction',
    },
  }));
  const results = await Promise.all(
    inputs.map(({ state }) =>
      renderSvg({ state, ast: table.minutes[state.t.slice(0, 4)][Number(state.t.slice(4))] }),
    ),
  );
  results.forEach((result, i) => {
    assert.equal(result.typography.profile, inputs[i].state.font);
    assert.equal(result.typography.numerals, inputs[i].state.numerals);
  });
});
