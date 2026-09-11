import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: ['unit', 'build', 'og'].map((name, groupOrder) => ({
      test: {
        name,
        environment: 'node',
        include: [`tests/${name}/*.test.ts`],
        // Unit tests wait on SymPy subprocesses; build/og run real Vite builds.
        testTimeout: name === 'unit' ? 30_000 : 120_000,
        hookTimeout: name === 'unit' ? 30_000 : 120_000,
        restoreMocks: true,
        fileParallelism: name === 'unit',
        sequence: { groupOrder },
        ...(name === 'og' ? { globalSetup: ['./tests/helpers/setup-og.ts'] } : {}),
      },
    })),
  },
});
