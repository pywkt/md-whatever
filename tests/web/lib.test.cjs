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

test('file names for new files, from their title', () => {
  assert.equal(lib.fileNameFor('Trip notes: May!'), 'trip-notes-may.md');
  assert.equal(lib.fileNameFor('  Ünïcode & 日本語 '), 'ünïcode-日本語.md');
  assert.equal(lib.fileNameFor('../../etc/passwd'), 'etc-passwd.md');
  assert.equal(lib.fileNameFor('x'.repeat(80)), 'x'.repeat(60) + '.md');
  assert.equal(lib.fileNameFor(`${'a'.repeat(59)} b`), 'a'.repeat(59) + '.md'); // no trailing dash
  assert.equal(lib.fileNameFor('?!'), 'untitled.md');
  assert.equal(lib.fileNameFor('', 'untitled-3.md'), 'untitled-3.md');
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

/* ---------- formatting toolbar ---------- */

// Writes a selection into the text as « and », to keep the cases readable.
const show = (r) => (r.error ? 'error: ' + r.error : r.text.slice(0, r.a) + '«' + r.text.slice(r.a, r.b) + '»' + r.text.slice(r.b));
// The reverse: "Hello «brave» world" -> text, a, b. A lone | is a caret.
function sel(marked) {
  const caret = marked.indexOf('|');
  if (caret >= 0) return { text: marked.replace('|', ''), a: caret, b: caret };
  const a = marked.indexOf('«');
  const b = marked.indexOf('»') - 1;
  return { text: marked.replace('«', '').replace('»', ''), a, b };
}
// Inline elements of a text, as the page finds them in its rendered DOM.
function els(text, list) {
  return list.map(([kind, content, from = 0]) => {
    const cs = text.indexOf(content, from);
    const o = lib.inlineOuter(text, kind, cs, cs + content.length);
    assert.ok(o, `${kind} around ${content}`);
    return { kind, cs, ce: cs + content.length, ...o };
  });
}

test('edits and position mapping', () => {
  const r = lib.applyEdits('abcdef', [{ at: 4, del: 2, ins: 'X' }, { at: 1, del: 0, ins: '**' }]);
  assert.equal(r.text, 'a**bcdX');
  assert.equal(r.map(1, -1), 1);
  assert.equal(r.map(1, 1), 3);
  assert.equal(r.map(5, 1), 7); // inside a replacement: its end
  assert.equal(r.map(6), 7);
  assert.deepEqual(lib.textDiff('hello world', 'hello brave world'), { start: 6, oldEnd: 6, newEnd: 12 });
  assert.deepEqual(lib.wordAt("it's here", 2), [0, 4]);
  assert.deepEqual(lib.wordAt('a  b', 2), [2, 2]);
});

test('element ranges from their content', () => {
  const t = 'x **b** *i* __u__ ~~d~~ `c` `` `x` `` $m$ [l](http://a.b "t") [r][ref] <http://x.y> www.z.org';
  const at = (s) => [t.indexOf(s), t.indexOf(s) + s.length];
  const outer = (kind, s, from) => {
    const [cs, ce] = from || at(s);
    const o = lib.inlineOuter(t, kind, cs, ce);
    return o && t.slice(o.s, o.e);
  };
  assert.equal(outer('strong', 'b'), '**b**');
  assert.equal(outer('em', 'i'), '*i*');
  assert.equal(outer('strong', 'u'), '__u__');
  assert.equal(outer('del', 'd'), '~~d~~');
  assert.equal(outer('code', 'c'), '`c`');
  assert.equal(outer('code', '`x`'), '`` `x` ``');
  assert.equal(outer('math', 'm'), '$m$');
  assert.equal(outer('link', 'l'), '[l](http://a.b "t")');
  assert.equal(outer('link', 'r'), '[r][ref]');
  assert.equal(outer('link', 'http://x.y'), '<http://x.y>');
  assert.equal(outer('link', 'www.z.org'), 'www.z.org');
  assert.equal(outer('strong', 'i'), null, 'not what the source says');
  const l = lib.inlineOuter(t, 'link', ...at('l'));
  assert.equal(t.slice(l.ds, l.de), 'http://a.b');
});

test('bold, italic, strikethrough, code', () => {
  const run = (marked, kind, list = [], opts) => {
    const { text, a, b } = sel(marked);
    return show(lib.toggleInline(text, a, b, kind, els(text, list), opts));
  };
  assert.equal(run('Hello «brave» world', 'strong'), 'Hello **«brave»** world');
  assert.equal(run('Hello« brave »world', 'em'), 'Hello *«brave»* world', 'spaces stay outside');
  assert.equal(run('Hello br|ave world', 'del'), 'Hello ~~«brave»~~ world', 'caret: the word');
  assert.equal(run('Hello | world', 'strong'), 'error: Select some text first, or put the cursor in a word.');
  assert.equal(run('Hello | world', 'strong', [], { empty: true }), 'Hello **«»** world');
  // toggling off: all of it, or split around the selection
  assert.equal(run('Hello **«brave»** world', 'strong', [['strong', 'brave']]), 'Hello «brave» world');
  assert.equal(run('Hello «**brave**» world', 'strong', [['strong', 'brave']]), 'Hello «brave» world', 'markers selected too');
  assert.equal(run('Hello __b«rav»e__ world', 'strong', [['strong', 'brave']]), 'Hello **b**«rav»**e** world');
  assert.equal(run('**one «two» three**', 'strong', [['strong', 'one two three']]), '**one** «two» **three**');
  assert.equal(run('Hello **br|ave** world', 'strong', [['strong', 'brave']]), 'Hello «brave» world', 'caret in bold');
  // merging with what it touches
  assert.equal(run('«a **b** c»', 'strong', [['strong', 'b']]), '**«a b c»**');
  assert.equal(run('a **b «c** d»', 'strong', [['strong', 'b c']]), 'a **«b c d»**');
  // never interleaved with other elements
  assert.equal(run('see [the li«nk](u) here»', 'strong', [['link', 'the link']]), 'see **«[the link](u) here»**');
  assert.equal(run('x `co«de` y» z', 'em', [['code', 'code']]), 'x *«`code` y»* z');
  assert.equal(run('a «*b*» c', 'em', [['em', 'b']]), 'a «b» c');
  // code: backticks inside take a longer fence
  assert.equal(run('run «a`b» now', 'code'), 'run ``«a`b»`` now');
  assert.equal(run('run «`x`» now', 'code'), 'run `` «`x`» `` now');
  assert.equal(run('run `«x»` now', 'code', [['code', 'x']]), 'run «x» now');
  // opaque (unknown) elements can't be cut
  const text = 'a xyz b';
  const r = lib.toggleInline(text, 0, 3, 'strong', [{ kind: 'link', s: 2, cs: 2, ce: 5, e: 5, opaque: true }]);
  assert.match(r.error, /can't be made bold/);
});

test('links', () => {
  const run = (marked, url, list = []) => {
    const { text, a, b } = sel(marked);
    return show(lib.setLink(text, a, b, url, els(text, list)));
  };
  assert.equal(run('Go «there» now', 'https://x.y'), 'Go [«there»](https://x.y) now');
  assert.equal(run('Go th|ere now', 'https://x.y'), 'Go [«there»](https://x.y) now');
  assert.equal(run('Go | now', 'https://x.y'), 'Go [«https://x.y»](https://x.y) now');
  assert.equal(run('a «b» c', 'my file.md'), 'a [«b»](<my file.md>) c');
  assert.equal(run('a [l«in»k](old "t") c', 'new', [['link', 'link']]), 'a [«link»](new "t") c', 'changes the address');
  assert.equal(run('a [lin«k»][r] c', 'new', [['link', 'link']]), 'a [«link»](new) c', 'reference link -> inline');
  assert.equal(run('a «b»', ''), 'error: Type the address for the link.');
  const rm = (marked, list) => {
    const { text, a, b } = sel(marked);
    return show(lib.removeLink(text, a, b, els(text, list)));
  };
  assert.equal(rm('a [li|nk](u) c', [['link', 'link']]), 'a «link» c');
  assert.equal(rm('see www.x.org| now', [['link', 'www.x.org']]).slice(0, 12), 'error: Web a');
  assert.equal(rm('no | link', []), 'error: There is no link here.');
});

test('block types: headings and paragraphs', () => {
  const run = (marked, kind) => {
    const { text, a, b } = sel(marked);
    return show(lib.applyBlock(text, a, b, kind));
  };
  assert.equal(run('one tw|o\n', 'h2'), '## one tw«»o\n');
  assert.equal(run('## one tw|o\n', 'h2'), 'one tw«»o\n', 'the same heading again: back to a paragraph');
  assert.equal(run('## one tw|o ##\n', 'p'), 'one tw«»o\n', 'closing hashes go too');
  assert.equal(run('# a|\n', 'h3'), '### a«»\n');
  assert.equal(run('first\nsec|ond  \nthird\n\nnext\n', 'h1'), '# first sec«»ond third\n\nnext\n', 'one line');
  assert.equal(run('Title|\n=====\n\ntext\n', 'p'), 'Title«»\n\ntext\n', 'setext');
  assert.equal(run('Title|\n---\n', 'h1'), '# Title«»\n');
  assert.equal(run('> - [ ] it|em\n', 'h2'), '> - [ ] ## it«»em\n', 'inside a quote and a task');
  assert.equal(run('«a\n\nb»\n', 'h1'), '«# a\n\n# b»\n');
  assert.equal(run('```\nco|de\n```\n', 'h1'), 'error: That is inside a code block. Only Quote and Code block apply there.');
  assert.equal(run('---\nti|tle: x\n---\nbody\n', 'h1'), 'error: That is the front matter at the top of the file. Use Edit to change it.');
});

test('block types: lists, quotes, code blocks, rules', () => {
  const run = (marked, kind) => {
    const { text, a, b } = sel(marked);
    return show(lib.applyBlock(text, a, b, kind));
  };
  assert.equal(run('«a\n\nb»\n', 'ul'), '«- a\n\n- b»\n');
  assert.equal(run('«a\n\nb»\n', 'ol'), '«1. a\n\n2. b»\n');
  assert.equal(run('«- a\n- b»\n', 'ol'), '«1. a\n2. b»\n', 'one kind of list to another');
  assert.equal(run('«1. a\n2. b»\n', 'ol'), '«a\nb»\n', 'off again');
  assert.equal(run('- [x] d|one\n- todo\n', 'task'), 'd«»one\n- todo\n', 'already a task: off');
  assert.equal(run('«- [x] done\n- todo»\n', 'task'), '«- [x] done\n- [ ] todo»\n', 'checked boxes stay checked');
  assert.equal(run('long par|agraph\nwrapped here\n', 'ul'), '- long par«»agraph\nwrapped here\n', 'one item');
  assert.equal(run('«a\n\nb»\n', 'quote'), '«> a\n>\n> b»\n');
  assert.equal(run('«> a\n>\n> b»\n', 'quote'), '«a\n\nb»\n');
  assert.equal(run('x\n\n«a\nb»\n\ny\n', 'code'), 'x\n\n«```\na\nb\n```»\n\ny\n');
  assert.equal(run('«a\n```js\nb\n```»\n', 'code'), '«````\na\n```js\nb\n```\n````»\n', 'longer fence around a fence');
  assert.equal(run('```js\nb|\n```\nafter\n', 'code'), 'b«»\nafter\n', 'off again');
  assert.equal(run('para|graph\nnext line\n', 'hr'), 'paragraph\nnext line\n\n---«»\n');
  assert.equal(run('> quo|ted\n', 'hr'), '> quoted\n>\n> ---«»\n');
});

test('the block at a position', () => {
  assert.deepEqual(lib.blockAt('# Title\n', 3), { block: 'h1', list: null, quote: false });
  assert.deepEqual(lib.blockAt('Title\n---\n', 2), { block: 'h2', list: null, quote: false });
  assert.deepEqual(lib.blockAt('> 1. item\n', 5), { block: 'p', list: 'ol', quote: true });
  assert.deepEqual(lib.blockAt('text\n\n```\ncode\n```\n', 12), { block: 'code', list: null, quote: false });
  assert.deepEqual(lib.blockAt('---\na: b\n---\n', 5), { block: 'fm', list: null, quote: false });
});

/* ---------- sharing ---------- */

test('shared files: encrypted, and back exactly', async () => {
  for (const text of ['', '# Notes\r\n\r\nCRLF stays.\r\n', 'emoji 😀 and ünïcödé\n', 'x'.repeat(200000)]) {
    const { bytes, key } = await lib.packShare({ name: 'notes.md', text });
    assert.match(key, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(lib.fromBase64url(key).length, 16);
    const back = await lib.unpackShare(bytes, key);
    assert.deepEqual(back, { name: 'notes.md', text });
  }
  // compressed before it's encrypted
  const big = await lib.packShare({ name: 'a.md', text: 'repeat '.repeat(50000) });
  assert.ok(big.bytes.length < 5000, `${big.bytes.length} bytes`);
  // the text isn't readable in the bytes
  const { bytes } = await lib.packShare({ name: 'secret.md', text: 'the password is hunter2' });
  assert.doesNotMatch(Buffer.from(bytes).toString('latin1'), /hunter2|secret/);
  // a fresh key and IV every time
  const a = await lib.packShare({ name: 'a.md', text: 'same' });
  const b = await lib.packShare({ name: 'a.md', text: 'same' });
  assert.notEqual(a.key, b.key);
  assert.notDeepEqual(a.bytes, b.bytes);
});

test('shared files: wrong key, damaged bytes and odd names', async () => {
  const { bytes, key } = await lib.packShare({ name: 'notes.md', text: 'hello' });
  const other = await lib.packShare({ name: 'x.md', text: 'x' });
  const damaged = async (b, k) => {
    await assert.rejects(lib.unpackShare(b, k), (err) => err instanceof lib.ShareError && err.code === 'damaged');
  };
  await damaged(bytes, other.key);
  await damaged(bytes, null);
  await damaged(bytes, key.slice(0, 21));
  await damaged(bytes, '!'.repeat(22));
  await damaged(bytes.subarray(0, 20), key);
  const flipped = bytes.slice();
  flipped[flipped.length - 1] ^= 1;
  await damaged(flipped, key);

  // names are file names only; a missing one gets a default
  const path = await lib.packShare({ name: '../../etc/passwd.md', text: 'x' });
  assert.equal((await lib.unpackShare(path.bytes, path.key)).name, 'passwd.md');
  const none = await lib.packShare({ name: '   ', text: 'x' });
  assert.equal((await lib.unpackShare(none.bytes, none.key)).name, 'shared.md');
});

test('shared files: from a newer reader', async () => {
  // what packShare does, with a version this reader doesn't know
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ v: lib.SHARE_VERSION + 1, name: 'a.md', text: 'x' }));
  const zipped = new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped));
  const bytes = new Uint8Array([...iv, ...sealed]);
  await assert.rejects(lib.unpackShare(bytes, lib.toBase64url(raw)), (err) => err.code === 'version');
});

test('share links', () => {
  const key = 'Tb8kQ2vX9mLpR4sN7wYc1A';
  assert.equal(lib.shareLink('https://md.wtvr.sh', 'k3J9x2Hq7v', key), `https://md.wtvr.sh/are/k3J9x2Hq7v#${key}`);
  assert.equal(lib.shareLink('http://127.0.0.1:8000/', 'k3J9x2Hq7v', key), `http://127.0.0.1:8000/are/k3J9x2Hq7v#${key}`);
  const parse = lib.parseShareLink;
  assert.deepEqual(parse(`https://md.wtvr.sh/are/k3J9x2Hq7v#${key}`), { id: 'k3J9x2Hq7v', key });
  assert.deepEqual(parse(`https://md.wtvr.sh/are/k3J9x2Hq7v/#${key}`), { id: 'k3J9x2Hq7v', key });
  assert.deepEqual(parse(`https://md.wtvr.sh/are/k3J9x2Hq7v#${key}).`), { id: 'k3J9x2Hq7v', key }, 'punctuation after it');
  assert.deepEqual(parse('https://md.wtvr.sh/are/k3J9x2Hq7v'), { id: 'k3J9x2Hq7v', key: null }, 'the #part cut off');
  assert.deepEqual(parse(`https://md.wtvr.sh/are/k3J9x2Hq7v#${key.slice(0, 15)}`), { id: 'k3J9x2Hq7v', key: null });
  assert.deepEqual(parse(`https://md.wtvr.sh/are/k3J9#${key}`), { id: null, key });
  assert.deepEqual(parse(`https://md.wtvr.sh/are/#${key}`), { id: null, key });
  assert.equal(parse(`https://md.wtvr.sh/#${key}`), null);
  assert.equal(parse('https://md.wtvr.sh/are/k3J9x2Hq7v/more'), null);
  assert.equal(parse('https://md.wtvr.sh/area/k3J9x2Hq7v'), null);
  assert.equal(parse('not a url'), null);
});

test('base64url', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  const s = lib.toBase64url(all);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(lib.fromBase64url(s), all);
  assert.equal(lib.fromBase64url('a+b/'), null);
  assert.deepEqual(lib.fromBase64url(''), new Uint8Array(0));
});
