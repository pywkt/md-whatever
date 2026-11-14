// Tests for the web reader's engine: the WebAssembly build, its JavaScript
// fallback and the native build of the same web/engine.cpp must produce
// identical bytes for every fixture, and the output must follow the contract
// in web/engine.h. Run by ctest (see CMakeLists.txt) with:
//   MDW_WEB_WASM=…/engine.wasm MDW_WEB_ASM=…/engine.asm.js MDW_ENGINE_NATIVE=…/engine_native \
//   node --test tests/web/engine.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see the comment at the top of this file)`);
  return v;
};

// The same WASI stubs web/reader.js passes: the engine never does I/O.
const WASI = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 };

function wrap(exports) {
  exports._initialize();
  const call = (fn, bytes) => {
    const ptr = exports.mdw_alloc(bytes.length);
    new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
    exports[fn](ptr, bytes.length);
    exports.mdw_free(ptr);
    return Buffer.from(new Uint8Array(exports.memory.buffer, exports.mdw_result_ptr(), exports.mdw_result_len()));
  };
  return {
    render: (input) => call('mdw_render', typeof input === 'string' ? Buffer.from(input) : input),
    slug: (text) => call('mdw_slugify', Buffer.from(text)).toString(),
  };
}

let wasm, asm;
test.before(async () => {
  const module = await WebAssembly.compile(fs.readFileSync(env('MDW_WEB_WASM')));
  const allowed = Object.keys(WASI).map((name) => `wasi_snapshot_preview1.${name}`);
  for (const i of WebAssembly.Module.imports(module))
    assert.ok(allowed.includes(`${i.module}.${i.name}`), `the engine may import only the no-op WASI stubs, not ${i.module}.${i.name}`);
  wasm = wrap((await WebAssembly.instantiate(module, { wasi_snapshot_preview1: WASI })).exports);
  // The fallback is a plain script defining mdwAsmEngine(), as inlined in the page.
  const factory = vm.runInNewContext(fs.readFileSync(env('MDW_WEB_ASM'), 'utf8') + '\n;mdwAsmEngine', {});
  asm = wrap(factory());
});

const native = (file) => execFileSync(env('MDW_ENGINE_NATIVE'), ['render', file], { maxBuffer: 64 << 20 });
const nativeSlug = (text) => execFileSync(env('MDW_ENGINE_NATIVE'), ['slug', text]).toString();

const fixtures = [
  ...fs.readdirSync(path.join(REPO, 'tests', 'fixtures')).filter((f) => f.endsWith('.md'))
    .map((f) => path.join(REPO, 'tests', 'fixtures', f)),
  path.join(REPO, 'README.md'),
];

test('every fixture renders identically: wasm, JS fallback, native', () => {
  for (const file of fixtures) {
    const bytes = fs.readFileSync(file); // raw bytes, so not-utf8.md is tested as it is
    const expected = native(file);
    assert.ok(wasm.render(bytes).equals(expected), `wasm differs from native for ${path.basename(file)}`);
    assert.ok(asm.render(bytes).equals(expected), `JS fallback differs from native for ${path.basename(file)}`);
  }
});

test('slugs match native', () => {
  for (const s of ['Hello World!', '  Spaced  Out ', 'Größe & Maß', '', "What's `new`?", 'a-b_c.d', '日本語 見出し']) {
    assert.equal(wasm.slug(s), nativeSlug(s), JSON.stringify(s));
    assert.equal(asm.slug(s), nativeSlug(s), JSON.stringify(s));
  }
});

// --- behavior, ported from tests/test_markdown.cpp and the output contract ---------

const html = (md) => wasm.render(md).toString();

test('headings get unique ids', () => {
  const h = html("# Hello World\n\n## Hello World\n\n### What's `new`?\n");
  assert.match(h, /<h1 id="hello-world">/);
  assert.match(h, /<h2 id="hello-world-1">/);
  assert.match(h, /<h3 id="whats-new">/);
});

test('raw HTML is escaped', () => {
  const h = html('<script>alert(1)</script>\n\nhi <b onclick=x>there</b>\n');
  assert.doesNotMatch(h, /<script/);
  assert.doesNotMatch(h, /<b /);
  assert.match(h, /&lt;script&gt;/);
});

test('tables with alignment', () => {
  const h = html('| a | b |\n|:--|--:|\n| 1 | 2 |\n');
  assert.match(h, /<table>/);
  assert.match(h, /text-align:right/);
});

test('task lists have no inputs', () => {
  const h = html('- [x] done\n- [ ] todo\n');
  assert.doesNotMatch(h, /<input/);
  assert.match(h, /task checked/);
  assert.equal(h.match(/<span class="task/g).length, 2);
});

test('code blocks follow the contract', () => {
  assert.equal(html('```  py  \nx = "<1>"\n```\n'),
    '<pre class="code" data-lang="py"><code>x = &quot;&lt;1&gt;&quot;\n</code></pre>\n');
  assert.equal(html('```\nplain\n```\n'), '<pre class="code"><code>plain\n</code></pre>\n');
  assert.match(html('```\nunclosed fence\n'), /<pre class="code">/);
});

test('math follows the contract', () => {
  assert.equal(html('Inline $x^2$ end.\n'), '<p>Inline <code class="math-pending">$x^2$</code> end.</p>\n');
  assert.equal(html('$$  a<b  $$\n'),
    '<p><span class="math-display"><code class="math-pending">$$a&lt;b$$</code></span>\n</p>\n');
  assert.equal(html('```math\n  c & d\n```\n'),
    '<span class="math-display"><code class="math-pending">$$c &amp; d$$</code></span>\n');
});

test('currency is not math', () => {
  const h = html('It costs $5 and $10, so \\$15 in total. A lone dollar: $\n');
  assert.doesNotMatch(h, /math-pending/);
  assert.match(h, /so \$15 in total/);
});

test('footnotes', () => {
  const h = html('Text[^1].\n\n[^1]: The note.\n');
  assert.match(h, /href="#fn-1"/);
  assert.match(h, /id="fn-1"/);
  assert.match(h, /footnote-back/);
});

test('front matter is hidden', () => {
  const h = html('---\ntitle: Secret\n---\n# Visible\n');
  assert.doesNotMatch(h, /Secret/);
  assert.match(h, /Visible/);
  assert.match(html('---\n\ntext\n'), /text/);
});

test('images keep alt text', () => {
  assert.match(html('![a *cat*](cat.png "Title")\n'), /<img src="cat.png" alt="a cat" title="Title">/);
});

test('long runs get break points', () => {
  const url = 'https://example.com/a/very/long/path/that/goes/on/and/on/index.html';
  const h = html(`See ${url} now\n`);
  assert.match(h, /<wbr>/);
  assert.ok(h.includes(`href="${url}"`));
  assert.doesNotMatch(html('short words only here\n'), /<wbr>/);
});

test('pathological input', () => {
  assert.equal(html(''), '');
  assert.match(html('line\r\nnext\r\n'), /line/);
  // a UTF-8 byte-order mark before the first heading
  assert.match(wasm.render(Buffer.from([0xEF, 0xBB, 0xBF, ...Buffer.from('# BOM\n')])).toString(), /<h1/);
});

test('repeated large renders stay stable', () => {
  const large = fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'large.md'));
  const first = wasm.render(large);
  for (let i = 0; i < 5; i++) assert.ok(wasm.render(large).equals(first));
  assert.equal(html('# after\n'), '<h1 id="after">after</h1>\n'); // the instance still works
});
