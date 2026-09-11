import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLicenses } from '../../tools/licenses.ts';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

// Minimal installed package tree, so drift cases never modify real dependencies.
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'formula-clock-licenses-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file: string, contents: string) => {
    const output = path.join(root, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, contents);
  };
  const packageInfo = { name: '@mathjax/src', version: '4.1.3', license: 'Apache-2.0' };
  write('package.json', JSON.stringify({ devDependencies: { '@mathjax/src': '4.1.3' } }));
  write('node_modules/@mathjax/src/package.json', JSON.stringify(packageInfo));
  write(
    'src/browser/typesetter.ts',
    "script.src = 'https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-svg-nofont.js';",
  );
  write(
    'licenses/manifest.json',
    JSON.stringify({
      reviewedOn: '2026-09-10',
      packages: { '@mathjax/src': packageInfo },
      texts: { sample: { file: 'licenses/sample.txt', source: 'https://example.org/?a=1&b=2' } },
    }),
  );
  write('licenses/sample.txt', 'Copyright <Author> & "Font"\n\n  Keep indentation.\n');
  write(
    'licenses/notice.html',
    '<p>{{version:@mathjax/src}} / {{reviewed-on}}</p><a href="{{source:sample}}">Source</a><pre>\n{{text:sample}}</pre>',
  );
  return { root, write, packageInfo };
}

test('license generation escapes source text without changing whitespace and is deterministic', (t) => {
  const { root } = fixture(t);
  const html = renderLicenses(root);
  assert.equal(
    html,
    '<p>4.1.3 / 2026-09-10</p><a href="https://example.org/?a=1&amp;b=2">Source</a><pre>\nCopyright &lt;Author&gt; &amp; &quot;Font&quot;\n\n  Keep indentation.\n</pre>',
  );
  assert.equal(renderLicenses(root), html);
});

test('license generation rejects dependency and CDN changes pending review', (t) => {
  const { root, write, packageInfo } = fixture(t);
  for (const change of [{ version: '4.2.0' }, { license: 'MIT' }]) {
    write('node_modules/@mathjax/src/package.json', JSON.stringify({ ...packageInfo, ...change }));
    assert.throws(() => renderLicenses(root), /License review required for @mathjax\/src/);
  }
  write('node_modules/@mathjax/src/package.json', JSON.stringify(packageInfo));
  write('package.json', JSON.stringify({ devDependencies: { '@mathjax/src': '4.2.0' } }));
  assert.throws(() => renderLicenses(root), /License review required/);
  write(
    'package.json',
    JSON.stringify({ devDependencies: { '@mathjax/src': '4.1.3', '@mathjax/new-font': '4.1.3' } }),
  );
  assert.throws(() => renderLicenses(root), /Missing license review for @mathjax\/new-font/);
  write('package.json', JSON.stringify({ devDependencies: { '@mathjax/src': '4.1.3' } }));
  write(
    'src/browser/typesetter.ts',
    "script.src = 'https://cdn.jsdelivr.net/npm/mathjax@4.2.0/tex-svg-nofont.js';",
  );
  assert.throws(() => renderLicenses(root), /CDN version does not match/);
});

test('license generation rejects missing text and template omissions', (t) => {
  const { root, write } = fixture(t);
  write('licenses/sample.txt', '');
  assert.throws(() => renderLicenses(root), /Empty license text/);
  fs.unlinkSync(path.join(root, 'licenses/sample.txt'));
  assert.throws(() => renderLicenses(root), /ENOENT/);
  write('licenses/sample.txt', 'License text');
  write('licenses/notice.html', '{{text:typo}}');
  assert.throws(() => renderLicenses(root), /Unknown license placeholder/);
  write('licenses/notice.html', '<p>License text accidentally omitted.</p>');
  assert.throws(() => renderLicenses(root), /License text is not included/);
});

test('project notices include every license, including the shared GUST text, without unresolved markers', () => {
  const html = renderLicenses(projectRoot);
  assert.equal((html.match(/<pre lang="en">/g) || []).length, 15);
  assert.equal(
    (html.match(/This is version 1.0, dated 22 June 2009, of the GUST Font License/g) || []).length,
    2,
  );
  assert.ok(html.includes('LaTeX Project Public License'));
  assert.ok(html.includes('Mozilla Public License Version 2.0'));
  assert.ok(!html.includes('{{'));
});
