import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'tests/browser');
const suites = fs
  .readdirSync(folder)
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => name.slice(0, -8))
  .sort();
const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log([...suites, 'all', 'compat/stix2'].join('\n'));
  process.exit(0);
}
const suite = (args[0] && !args[0].startsWith('-') ? args.shift()! : 'clock').replaceAll('_', '-');
if (!suites.includes(suite) && suite !== 'all' && suite !== 'compat/stix2') {
  console.error(`Unknown browser suite: ${suite}. Use --list to see available suites.`);
  process.exit(1);
}
function run(arguments_: string[], env = process.env) {
  const result = spawnSync(process.execPath, arguments_, { cwd: root, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const selected = suite === 'all' ? suites : [suite];
const files = selected.map((name) =>
  name === 'compat/stix2'
    ? path.join(root, 'tests/compat/stix2.test.ts')
    : path.join(folder, `${name}.test.ts`),
);
const env = {
  ...process.env,
  FORMULA_CLOCK_BROWSER_ARGS: JSON.stringify(args),
  FORMULA_CLOCK_BROWSER_ALL: String(suite === 'all'),
};
if (args.includes('--help') || args.includes('-h')) {
  if (suite === 'all')
    console.log(
      'Usage: npm run test:browser -- all [--browser chromium|webkit] [--url URL] [--output-dir DIRECTORY]\n\nStart the local Worker and run npm run test:og before running all browser suites.',
    );
  else run(['--import', 'tsx', files[0]], env);
  process.exit(0);
}
// Keep file:// coverage reproducible without relying on a checked-in or stale HTML build.
run(['--import', 'tsx', 'tools/build.ts']);
// Sequential files keep animation measurements independent and avoid racing builds.
run(['--import', 'tsx', '--test', '--test-concurrency=1', ...files], env);
