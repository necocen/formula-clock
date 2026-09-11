'use strict';
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const I18n = require('../../src/shared/i18n.ts');

test('Japanese language tags use Japanese; every other language falls back to English', () => {
  for (const language of ['ja', 'ja-JP', 'JA-jp', ' ja-JP '])
    assert.equal(I18n.resolveLanguage(language), 'ja');
  for (const language of [
    undefined,
    null,
    '',
    'en-US',
    'fr-FR',
    'zh-CN',
    'ar',
    'jargon',
    'javascript',
  ])
    assert.equal(I18n.resolveLanguage(language), 'en');
  assert.equal(I18n.create('ja-JP').t('settings'), '設定');
  assert.equal(I18n.create('de-DE').t('settings'), 'Settings');
  assert.equal(I18n.create('ja').t('previewSecond', { seconds: 3 }), '3秒をプレビュー');
  assert.equal(I18n.create('en').t('previewSecond', { seconds: 3 }), 'Preview second 3');
});
test('both languages cover all UI keys and use the same interpolation values', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, entry] of Object.entries(I18n.messages)) {
    assert.equal(typeof entry.ja, 'string', key);
    assert.ok(entry.ja.length, key);
    assert.equal(typeof entry.en, 'string', key);
    assert.ok(entry.en.length, key);
    assert.deepEqual(placeholders(entry.ja), placeholders(entry.en), key);
  }
  const html = fs.readFileSync(path.join(__dirname, '../../src/browser/app.html'), 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-(?:aria-label|title))?="([^"]+)"/g))
    assert.ok(Object.hasOwn(I18n.messages, match[1]), match[1]);
});
