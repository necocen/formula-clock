import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Builds from installed packages and reviewed local copies; never fetches from the network.
export function renderLicenses(root = projectRoot): string {
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
  for (const [id, source] of Object.entries(manifest.texts)) {
    if (!isRecord(source) || typeof source.file !== 'string' || typeof source.source !== 'string')
      throw new Error(`Invalid license text record: ${id}`);
    const text = read(source.file);
    if (!text.trim()) throw new Error(`Empty license text: ${source.file}`);
    values.set(`text:${id}`, text);
    values.set(`source:${id}`, source.source);
  }
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
  const html = renderLicenses();
  const output = path.join(projectRoot, 'dist/licenses.html');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  console.log(`${output}: ${Buffer.byteLength(html)} bytes`);
}
