import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function setup() {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    // Vitest sets NODE_ENV=test; Vite builds must exercise production behavior.
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'inherit',
  });
}
