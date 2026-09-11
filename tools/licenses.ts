import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isRecord } from '../src/shared/types.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#x27;';
    }
  });
}

async function readLicenseText(root: string, source: Record<string, unknown>): Promise<string> {
  if (typeof source.file !== 'string') throw new Error('Missing license text path');
  const file = path.join(root, source.file);
  if (source.download === undefined) return fs.readFileSync(file, 'utf8');
  if (
    typeof source.download !== 'string' ||
    !source.download.startsWith('https://') ||
    typeof source.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source.sha256)
  )
    throw new Error(`Invalid license download record: ${source.file}`);
  const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  if (fs.existsSync(file)) {
    const cached = fs.readFileSync(file);
    if (hash(cached) === source.sha256) return cached.toString('utf8');
  }
  const response = await fetch(source.download, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok)
    throw new Error(`License download failed (${response.status}): ${source.download}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash(data) !== source.sha256) throw new Error(`License SHA-256 mismatch: ${source.download}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return data.toString('utf8');
}

// Missing or invalid cached texts are fetched and checked before HTML is produced.
export async function renderLicenses(root = projectRoot): Promise<string> {
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
  const json = (file: string): Record<string, unknown> => {
    const value: unknown = JSON.parse(read(file));
    if (!isRecord(value)) throw new Error(`Expected an object in ${file}`);
    return value;
  };
  const manifest = json('licenses/manifest.json');
  if (
    !isRecord(manifest.packages) ||
    !isRecord(manifest.texts) ||
    typeof manifest.reviewedOn !== 'string'
  )
    throw new Error('Invalid license manifest');
  const dependencies = json('package.json').devDependencies;
  if (!isRecord(dependencies)) throw new Error('Missing project devDependencies');
  const values = new Map<string, string>([['reviewed-on', manifest.reviewedOn]]);
  for (const [name, reviewed] of Object.entries(manifest.packages)) {
    if (
      !isRecord(reviewed) ||
      typeof reviewed.version !== 'string' ||
      typeof reviewed.license !== 'string'
    )
      throw new Error(`Invalid license record for ${name}`);
    const installed = json(`node_modules/${name}/package.json`);
    if (
      installed.name !== name ||
      installed.version !== reviewed.version ||
      installed.license !== reviewed.license ||
      dependencies[name] !== reviewed.version
    )
      throw new Error(
        `License review required for ${name}: check the installed version, license, and licenses/manifest.json`,
      );
    values.set(`version:${name}`, reviewed.version);
  }
  for (const name of Object.keys(dependencies).filter((name) => /^@(mathjax|resvg)\//.test(name))) {
    if (!values.has(`version:${name}`)) throw new Error(`Missing license review for ${name}`);
  }
  // The browser loads MathJax from the CDN, while the Worker uses @mathjax/src.
  const cdnVersion = read('src/browser/typesetter.ts').match(/npm\/mathjax@([^/]+)\//)?.[1];
  if (!cdnVersion || cdnVersion !== values.get('version:@mathjax/src'))
    throw new Error('Browser MathJax CDN version does not match the reviewed license version');
  await Promise.all(
    Object.entries(manifest.texts).map(async ([id, source]) => {
      if (!isRecord(source) || typeof source.file !== 'string' || typeof source.source !== 'string')
        throw new Error(`Invalid license text record: ${id}`);
      const text = await readLicenseText(root, source);
      if (!text.trim()) throw new Error(`Empty license text: ${source.file}`);
      // HTML normalizes CRLF as well; keep the generated source consistent with the DOM.
      values.set(`text:${id}`, text.replace(/\r\n?/g, '\n'));
      values.set(`source:${id}`, source.source);
    }),
  );
  const used = new Set<string>();
  const html = read('licenses/notice.html').replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => {
    const value = values.get(key);
    if (value === undefined) throw new Error(`Unknown license placeholder: ${key}`);
    used.add(key);
    return escapeHtml(value);
  });
  for (const id of Object.keys(manifest.texts)) {
    if (!used.has(`text:${id}`))
      throw new Error(`License text is not included in the template: ${id}`);
  }
  return html;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = await renderLicenses();
  const output = path.join(projectRoot, 'dist/licenses.html');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  console.log(`${output}: ${Buffer.byteLength(html)} bytes`);
}
