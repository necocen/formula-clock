// Import an externally generated day after checking every hour, minute and AST.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeMinute,SCHEMA} from '../data.ts';
import {isRecord} from '../types.ts';

const root = fileURLToPath(new URL('../',import.meta.url));
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node --import tsx tools/import-data.ts DIRECTORY_WITH_00_TO_23_JSON');
const lines: string[] = [];
let equations = 0;
for (let h=0;h<24;h++) {
  const hour = String(h).padStart(2,'0');
  const value: unknown = JSON.parse(fs.readFileSync(path.join(directory,hour+'.json'),'utf8'));
  if (!isRecord(value) || value.schema !== SCHEMA || !isRecord(value.minutes) ||
      Object.keys(value).some(key => !['schema','minutes'].includes(key)) || Object.keys(value.minutes).length !== 60) {
    throw new Error(`Invalid hour ${hour}`);
  }
  for (let m=0;m<60;m++) {
    const code = hour+String(m).padStart(2,'0');
    const minute = normalizeMinute({schema:SCHEMA,hhmm:code,seconds:value.minutes[code]},code);
    equations += minute.seconds.filter(ast => ast !== null).length;
    lines.push(`    "${code}": ${JSON.stringify(minute.seconds)}`);
  }
}
// One chronological minute per line makes future dataset changes reviewable.
const json = `{\n  "schema": "${SCHEMA}",\n  "minutes": {\n${lines.join(',\n')}\n  }\n}\n`;
fs.writeFileSync(path.join(root,'data/expressions.json'),json);
console.log({minutes:lines.length,equations,ordinaryTime:86400-equations,jsonBytes:Buffer.byteLength(json)});
console.log('Run npm run build and npm test to verify exact values and regenerate the standalone app.');
