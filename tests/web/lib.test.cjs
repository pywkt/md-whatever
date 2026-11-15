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

/* ---------- saving gives back the bytes that were read ---------- */

const fs = require('node:fs');
const path = require('node:path');
const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name)));

// What the editor does on an untouched save: decode, textarea-normalize, put the
// line ending back, encode.
function roundTrip(bytes) {
  const r = lib.decodeBytes(bytes);
  const text = lib.withLineEnding(lib.normalizeNewlines(r.text), lib.lineEnding(r.text));
  return lib.encodeText(text, r).bytes;
}

test('files come back byte for byte: fixtures', () => {
  for (const name of ['crlf.md', 'not-utf8.md', 'kitchen-sink.md', 'math.md', 'empty.md', 'pathological.md']) {
    const bytes = fixture(name);
    assert.deepEqual(roundTrip(bytes), bytes, name);
  }
  const crlf = lib.decodeBytes(fixture('crlf.md'));
  assert.equal(crlf.encoding, 'utf-8');
  assert.equal(lib.lineEnding(crlf.text), '\r\n');
  assert.ok(!crlf.text.endsWith('\n'), 'crlf.md has no final newline, and keeps none');
  assert.equal(lib.decodeBytes(fixture('not-utf8.md')).encoding, 'latin1');
});

test('files come back byte for byte: BOM, CR only, no final newline', () => {
  const enc = (s) => new TextEncoder().encode(s);
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('# Title\r\n\r\nbody')]);
  const r = lib.decodeBytes(withBom);
  assert.equal(r.bom, true);
  assert.equal(r.text, '# Title\r\n\r\nbody', 'the BOM is not part of the text');
  assert.deepEqual(roundTrip(withBom), withBom);
  assert.deepEqual(roundTrip(enc('a\nb')), enc('a\nb'));
  assert.deepEqual(roundTrip(enc('a\n\n\n')), enc('a\n\n\n'));
  assert.deepEqual(roundTrip(enc('')), enc(''));
});

test('edited text gets the file line ending back', () => {
  assert.equal(lib.lineEnding('a\r\nb\r\nc\n'), '\r\n', 'mostly CRLF');
  assert.equal(lib.lineEnding('a\r\nb\nc\n'), '\n', 'mostly LF');
  assert.equal(lib.lineEnding('no newline'), '\n');
  assert.equal(lib.normalizeNewlines('a\r\nb\rc\n'), 'a\nb\nc\n');
  assert.equal(lib.withLineEnding('a\nb\n', '\r\n'), 'a\r\nb\r\n');
  assert.equal(lib.withLineEnding('a\r\nb\n', '\n'), 'a\nb\n');
});

test('Latin-1 (as browsers read it: windows-1252) round-trips every byte', () => {
  const all = new Uint8Array(255).map((_, i) => i + 1); // NUL would mean binary
  const r = lib.decodeBytes(new Uint8Array([0xff, 0xfe, ...all])); // not valid UTF-8
  assert.equal(r.encoding, 'latin1');
  assert.equal(r.text[0x80 + 2 - 1], '€', '0x80 reads as the euro sign');
  assert.deepEqual(lib.encodeText(r.text, r).bytes, new Uint8Array([0xff, 0xfe, ...all]));
  assert.deepEqual(lib.encodeText('café €', { encoding: 'latin1' }).bytes, new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]));
  assert.deepEqual(lib.encodeText('a → b', { encoding: 'latin1' }), { unencodable: '→' });
  assert.deepEqual(lib.encodeText('a \u{1f600}', { encoding: 'latin1' }), { unencodable: '\u{1f600}' });
});

test('binary files are refused', () => {
  assert.deepEqual(lib.decodeBytes(new Uint8Array([0x23, 0, 0x41])), { binary: true });
});
