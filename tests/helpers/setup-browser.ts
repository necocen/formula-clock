import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function setup() {
  execFileSync(process.execPath, ['--import', 'tsx', 'tools/build.ts'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    stdio: 'inherit',
  });
}
