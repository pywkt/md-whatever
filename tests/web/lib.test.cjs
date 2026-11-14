// Tests for web/lib.js, the web reader's pure helpers.  node --test tests/web/lib.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../../web/lib.js');

test('theme selectors are pointed at the shadow root', () => {
  assert.equal(lib.scopeSelector(':root'), ':host');
  assert.equal(lib.scopeSelector('html'), ':host');
  assert.equal(lib.scopeSelector('html.dark'), ':host(.dark)');
  assert.equal(lib.scopeSelector('html.dark pre code'), ':host(.dark) pre code');
  assert.equal(lib.scopeSelector('body'), '.mdw-page');
  assert.equal(lib.scopeSelector(' body > p'), ' .mdw-page > p');
  // words that merely contain the names stay as they are
  assert.equal(lib.scopeSelector('.htmlish, .tbody, tbody tr'), '.htmlish, .tbody, tbody tr');
  assert.equal(lib.scopeSelector(':root-ish'), ':root-ish');
});

test('whole stylesheets: comments dropped, every selector in a list scoped', () => {
  const css = lib.scopeCss('/* note */\nhtml.dark, body { color: red; }\n:root { --x: 1; }');
  assert.doesNotMatch(css, /note/);
  assert.match(css, /:host\(\.dark\),\s*\.mdw-page\s*\{/);
  assert.match(css, /:host\s*\{ --x: 1; \}/);
  // at-rules are left alone
  assert.match(lib.scopeCss('@media (max-width: 1px) { body { x: y; } }'), /@media \(max-width: 1px\)/);
});

test('palette variables', () => {
  const light = lib.paletteCss(false, 1);
  const dark = lib.paletteCss(true, 1.5);
  assert.match(light, /^:host \{\n/);
  assert.match(light, /--bg: #ffffff;/);
  assert.match(light, /--text: #232629;/);
  assert.match(light, /--base-size: 16\.00px;/);
  assert.match(dark, /--bg: #141618;/);
  assert.match(dark, /--base-size: 24\.00px;/);
  assert.equal(lib.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(lib.mix('#123456', '#abcdef', 0), '#123456');
});

test('paths', () => {
  assert.equal(lib.baseName('a/b/c.md'), 'c.md');
  assert.equal(lib.dirName('a/b/c.md'), 'a/b');
  assert.equal(lib.dirName('c.md'), '');
  assert.equal(lib.extOf('notes.MD'), 'md');
  assert.equal(lib.extOf('.hidden'), '');
  assert.equal(lib.extOf('dir.d/file'), '');
  assert.equal(lib.resolvePath('docs/guide', '../img/a.png'), 'docs/img/a.png');
  assert.equal(lib.resolvePath('docs', './x/./y.md'), 'docs/x/y.md');
  assert.equal(lib.resolvePath('docs', '/top.md'), 'top.md');
  assert.equal(lib.resolvePath('', 'a.md'), 'a.md');
  assert.equal(lib.resolvePath('a', '../../../b.md'), 'b.md');
});

test('links', () => {
  assert.deepEqual(lib.splitHref('other.md#Some%20Part'), { path: 'other.md', frag: 'Some Part' });
  assert.deepEqual(lib.splitHref('#top'), { path: '', frag: 'top' });
  assert.deepEqual(lib.splitHref('a%20b.md?x=1'), { path: 'a b.md', frag: '' });
  assert.deepEqual(lib.splitHref('bad%E0.md'), { path: 'bad%E0.md', frag: '' }); // undecodable: kept
  assert.ok(lib.hasScheme('https://example.com'));
  assert.ok(lib.hasScheme('mailto:x@example.com'));
  assert.ok(!lib.hasScheme('notes/a.md'));
  assert.ok(!lib.hasScheme('./c.md'));
});

test('document titles for the sidebar', () => {
  assert.equal(lib.titleOf('intro\n\n## The *real* `title` ##\n'), 'The real title');
  assert.equal(lib.titleOf('no heading here'), '');
  assert.equal(lib.titleOf('    # indented code, not a heading\n'), '');
});
