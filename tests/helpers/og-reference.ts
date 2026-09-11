import type { SharedClockState } from '../../src/shared/types.ts';
import { loadTable } from './table.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRenderer, renderSvg, pngFromSvg, renderDefaultOg } from '../../src/worker/render.ts';
import samples from '../fixtures/og-cases.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
function assertPng(bytes: Uint8Array) {
  const png = Buffer.from(bytes);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
}

// Shared reference generation keeps parity tests independent of earlier test runs.
export async function renderOgReference(output = path.resolve(root, 'test-results/og')) {
  const table = loadTable();
  await initRenderer(
    await fs.readFile(path.join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')),
  );
  await fs.mkdir(output, { recursive: true });
  const cases = [];
  for (const font of ['stix2', 'termes', 'fira', 'euler'] as const)
    for (const numerals of ['oldstyle', 'lining'] as const)
      for (const division of ['fraction', 'inline', 'slash'] as const)
        for (const sample of samples) {
          const state: SharedClockState = { v: 1, t: sample.t, font, numerals, division },
            ast = table.minutes[state.t.slice(0, 4)][Number(state.t.slice(4))];
          const result = await renderSvg({ state, ast }),
            { fit, ink } = result;
          assert.ok(Math.abs(result.axisY * fit.scale + fit.y - 315) < 0.001);
          assert.ok(ink.x * fit.scale + fit.x >= 50 && (ink.x + ink.w) * fit.scale + fit.x <= 1150);
          assert.ok(ink.y * fit.scale + fit.y >= 130 && (ink.y + ink.h) * fit.scale + fit.y <= 500);
          assert.ok(result.slots.every((paths) => paths.length > 0));
          assert.equal(result.typography.axisMode, numerals === 'lining' ? 'numeric' : 'font');
          assert.ok(result.svg.includes('id="brand"'));
          if (!ast) {
            assert.ok(!result.svg.includes('rgb('), 'Resting colors use portable SVG hex notation');
            assert.ok(
              result.svg.includes('color="#c8aba3"'),
              'Resting hour digit retains its desaturated warm color',
            );
          }
          const png = pngFromSvg(result.svg);
          assertPng(png);
          const name = `${font}-${numerals}-${division}-${sample.label}`;
          await fs.writeFile(path.join(output, name + '.png'), png);
          const { svg: _svg, ...metrics } = result;
          cases.push({ name, state, ...metrics, bytes: png.byteLength });
        }
  assert.equal(cases.length, 240);
  assertPng(renderDefaultOg());
  await fs.writeFile(path.join(output, 'default.png'), renderDefaultOg());
  await fs.writeFile(
    path.join(output, 'render-results.json'),
    JSON.stringify(
      {
        node: process.version,
        mathjax: '4.1.3',
        resvg: '2.6.2',
        at: new Date().toISOString(),
        cases,
      },
      null,
      2,
    ),
  );
}
