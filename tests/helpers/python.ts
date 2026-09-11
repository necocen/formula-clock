import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Python is reserved for SymPy; test orchestration stays in Node. */
export function pythonJson(script: URL, input: unknown, args: string[] = []): unknown {
  const venv = path.join(
    root,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const python = process.env.FORMULA_CLOCK_PYTHON || venv;
  if (!process.env.FORMULA_CLOCK_PYTHON && !fs.existsSync(venv)) {
    throw new Error('Python test environment is missing. Run pnpm install.');
  }
  const result = spawnSync(python, [fileURLToPath(script), ...args], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Python verification failed. Run pnpm install to prepare the test environment.\n${result.error || result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}
