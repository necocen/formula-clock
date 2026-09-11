import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderLicenses } from '../../tools/licenses.ts';

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
  const manifest = {
    reviewedOn: '2026-09-10',
    packages: { '@mathjax/src': packageInfo },
    texts: { sample: { file: 'licenses/sample.txt', source: 'https://example.org/?a=1&b=2' } },
  };
  write('licenses/manifest.json', JSON.stringify(manifest));
  write('licenses/sample.txt', 'Copyright <Author> & "Font"\n\n  Keep indentation.\n');
  write(
    'licenses/notice.html',
    '<p>{{version:@mathjax/src}} / {{reviewed-on}}</p><a href="{{source:sample}}">Source</a><pre>\n{{text:sample}}</pre>',
  );
  return { root, write, packageInfo, manifest };
}

function downloadFixture(t: TestContext) {
  const fixtureFiles = fixture(t);
  const { root, write, manifest } = fixtureFiles;
  const text = 'Copyright <Author> & "Font"\r\n\r\n  Keep indentation.\r\n';
  const download = 'https://example.org/pinned-commit/LICENSE';
  write(
    'licenses/manifest.json',
    JSON.stringify({
      ...manifest,
      texts: {
        sample: {
          ...manifest.texts.sample,
          download,
          sha256: createHash('sha256').update(text).digest('hex'),
        },
      },
    }),
  );
  fs.unlinkSync(path.join(root, 'licenses/sample.txt'));
  return { ...fixtureFiles, text, download };
}

test('missing license cache is downloaded, verified, reused offline, and repaired if corrupt', async (t) => {
  const { root, write, text, download } = downloadFixture(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(text));
  const html = await renderLicenses(root);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(fetchMock.mock.calls[0].arguments[0], download);
  assert.equal(fs.readFileSync(path.join(root, 'licenses/sample.txt'), 'utf8'), text);
  assert.ok(
    html.includes('Copyright &lt;Author&gt; &amp; &quot;Font&quot;\n\n  Keep indentation.\n'),
  );
  assert.equal(await renderLicenses(root), html);
  assert.equal(fetchMock.mock.callCount(), 1);
  write('licenses/sample.txt', 'Corrupted cache');
  assert.equal(await renderLicenses(root), html);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('unverified or failed downloads never become license cache files', async (t) => {
  const { root } = downloadFixture(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('Wrong license'));
  await assert.rejects(() => renderLicenses(root), /SHA-256 mismatch/);
  assert.ok(!fs.existsSync(path.join(root, 'licenses/sample.txt')));
  fetchMock.mock.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
  await assert.rejects(() => renderLicenses(root), /License download failed \(503\)/);
  assert.ok(!fs.existsSync(path.join(root, 'licenses/sample.txt')));
});

test('license generation escapes source text without changing whitespace and is deterministic', async (t) => {
  const { root } = fixture(t);
  const html = await renderLicenses(root);
  assert.equal(
    html,
    '<p>4.1.3 / 2026-09-10</p><a href="https://example.org/?a=1&amp;b=2">Source</a><pre>\nCopyright &lt;Author&gt; &amp; &quot;Font&quot;\n\n  Keep indentation.\n</pre>',
  );
  assert.equal(await renderLicenses(root), html);
});

test('license generation rejects dependency and CDN changes pending review', async (t) => {
  const { root, write, packageInfo } = fixture(t);
  for (const change of [{ version: '4.2.0' }, { license: 'MIT' }]) {
    write('node_modules/@mathjax/src/package.json', JSON.stringify({ ...packageInfo, ...change }));
    await assert.rejects(() => renderLicenses(root), /License review required for @mathjax\/src/);
  }
  write('node_modules/@mathjax/src/package.json', JSON.stringify(packageInfo));
  write('package.json', JSON.stringify({ devDependencies: { '@mathjax/src': '4.2.0' } }));
  await assert.rejects(() => renderLicenses(root), /License review required/);
  write(
    'package.json',
    JSON.stringify({ devDependencies: { '@mathjax/src': '4.1.3', '@mathjax/new-font': '4.1.3' } }),
  );
  await assert.rejects(() => renderLicenses(root), /Missing license review for @mathjax\/new-font/);
  write('package.json', JSON.stringify({ devDependencies: { '@mathjax/src': '4.1.3' } }));
  write(
    'src/browser/typesetter.ts',
    "script.src = 'https://cdn.jsdelivr.net/npm/mathjax@4.2.0/tex-svg-nofont.js';",
  );
  await assert.rejects(() => renderLicenses(root), /CDN version does not match/);
});

test('license generation rejects missing text and template omissions', async (t) => {
  const { root, write } = fixture(t);
  write('licenses/sample.txt', '');
  await assert.rejects(() => renderLicenses(root), /Empty license text/);
  fs.unlinkSync(path.join(root, 'licenses/sample.txt'));
  await assert.rejects(() => renderLicenses(root), /ENOENT/);
  write('licenses/sample.txt', 'License text');
  write('licenses/notice.html', '{{text:typo}}');
  await assert.rejects(() => renderLicenses(root), /Unknown license placeholder/);
  write('licenses/notice.html', '<p>License text accidentally omitted.</p>');
  await assert.rejects(() => renderLicenses(root), /License text is not included/);
});
