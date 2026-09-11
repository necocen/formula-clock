import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function setup() {
  execFileSync(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'build', '--mode', 'standalone'],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: 'inherit',
    },
  );
}
