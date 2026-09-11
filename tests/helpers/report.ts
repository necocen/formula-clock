import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default function writeReport(name: string, report: unknown): void {
  const folder = fileURLToPath(new URL('../../test-results/unit/', import.meta.url));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), JSON.stringify(report, null, 2) + '\n');
}
