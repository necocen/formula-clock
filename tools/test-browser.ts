import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'tests/browser');
const suites = fs
  .readdirSync(folder)
  .filter((name) => name.endsWith('.py') && !name.startsWith('_'))
  .map((name) => name.slice(0, -3))
  .sort();
const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log(suites.join('\n'));
  process.exit(0);
}
const suite = args[0] && !args[0].startsWith('-') ? args.shift()! : 'clock';
if (!suites.includes(suite)) {
  console.error(`Unknown browser suite: ${suite}. Use --list to see available suites.`);
  process.exit(1);
}
function run(command: string, arguments_: string[]) {
  const result = spawnSync(command, arguments_, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Keep file:// coverage reproducible without relying on a checked-in or stale HTML build.
if (!args.includes('--help') && !args.includes('-h')) {
  run(process.execPath, ['--import', 'tsx', 'tools/build.ts']);
}
const venv = path.join(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const python = process.env.FORMULA_CLOCK_PYTHON || (fs.existsSync(venv) ? venv : 'python3');
run(python, [path.join(folder, `${suite}.py`), ...args]);
