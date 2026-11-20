(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const DATA = JSON.parse($('mdw-data').textContent);
const {
  paletteCss, scopeCss, baseName, dirName, extOf, resolvePath, splitHref, hasScheme, titleOf,
  decodeBytes, encodeText, normalizeNewlines, lineEnding, withLineEnding,
  textDiff, inlineOuter, toggleInline, setLink, removeLink, blockAt, applyBlock,
  packShare, unpackShare, shareLink, parseShareLink,
} = mdwLib; // web/lib.js

// Same list as kMarkdownSuffixes in md-whatever's mainwindow.cpp.
const MD_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn']);
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico']);
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', '__pycache__']);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FOLDER_DOCS = 200;
const MAX_FOLDER_ENTRIES = 4000;
const NOT_UTF8 = 'This file is not valid UTF-8. It is shown as Latin-1, so some characters may be wrong.';

const HLJS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/';
const HLJS_SRI = 'sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU';
const MATHJAX = 'https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-svg.js';
const MATHJAX_SRI = 'sha384-my9P1jDckpHD+5LZsLQ0gaiCl/RMO32HaqwBtbo/25QIMVr6xXIUCg1jvdSRcvb4';

/* ---------- preferences (per browser; the app keeps these in md-whatever.conf) ---------- */

const prefs = { theme: 'default', appearance: 'system', zoom: 1, railWidth: 268, webImages: false, toolbar: false };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem('md-whatever-reader') || '{}'));
} catch (err) { /* private window or blocked storage: defaults are fine */ }
if (!DATA.themes[prefs.theme] || prefs.theme === 'base') prefs.theme = 'default';
function savePrefs() {
  try { localStorage.setItem('md-whatever-reader', JSON.stringify(prefs)); } catch (err) { /* ignore */ }
}

/* ---------- md-whatever's Markdown engine ---------- */

const engine = (() => {
  const wasi = { fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0 };
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let module = null;
  let x = null;
  let kind = '';

  async function boot() {
    x = null;
    let exports;
    if (module) exports = (await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi })).exports;
    else exports = window.mdwAsmEngine(); // same code translated to plain JS, for pages where wasm is blocked
    exports._initialize();
    x = exports;
  }

  async function init() {
    try {
      const bin = atob($('mdw-wasm').textContent.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      module = await WebAssembly.compile(bytes);
      kind = 'wasm';
    } catch (err) {
      module = null;
      kind = 'js';
    }
    await boot();
  }

  function call(fn, text) {
    if (!x) throw new Error('The Markdown engine is restarting. Switch files and come back.');
    try {
      const bytes = enc.encode(text);
      const ptr = x.mdw_alloc(bytes.length);
      new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
      x[fn](ptr, bytes.length);
      x.mdw_free(ptr);
      return dec.decode(new Uint8Array(x.memory.buffer, x.mdw_result_ptr(), x.mdw_result_len()));
    } catch (err) {
      boot().catch(() => {}); // a trap leaves the instance unusable; start a fresh one
      throw err;
    }
  }

  return {
    init,
    render: (text) => call('mdw_render', text),
    renderMapped: (text) => call('mdw_render_mapped', text), // with the source map (web/engine.h)
    slugify: (text) => call('mdw_slugify', text),
    get kind() { return kind; },
  };
})();

/* ---------- elements ---------- */

const app = $('app');
const host = $('viewer');
const emptyEl = $('empty');
const listEl = $('file-list');
const root = host.attachShadow({ mode: 'open' });
const styleBase = document.createElement('style');
const styleTheme = document.createElement('style');
const styleCode = document.createElement('style');
const page = document.createElement('div');
page.className = 'mdw-page';
{
  const [a, b] = DATA.viewerCss.split('/*--B--*/');
  styleBase.textContent = a;
  styleCode.textContent = b;
}
root.append(styleBase, styleTheme, styleCode, page);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let toastTimer = 0;
function toast(message, ms = 4200) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- themes: a port of Theme::css() from md-whatever's theme.cpp ---------- */

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const narrow = matchMedia('(max-width: 720px)');

function isDark() {
  if (prefs.appearance !== 'system') return prefs.appearance === 'dark';
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'dark' || forced === 'light') return forced === 'dark';
  return systemDark.matches;
}

const scopedThemes = new Map();
function scopedTheme(name) {
  if (!scopedThemes.has(name)) scopedThemes.set(name, scopeCss(DATA.themes.base + '\n' + DATA.themes[name]));
  return scopedThemes.get(name);
}

function applyTheme() {
  const dark = isDark();
  if (prefs.appearance === 'system') delete document.documentElement.dataset.appearance;
  else document.documentElement.dataset.appearance = prefs.appearance;
  host.classList.toggle('dark', dark);
  host.classList.toggle('light', !dark);
  styleTheme.textContent = paletteCss(dark, prefs.zoom) + scopedTheme(prefs.theme);
  $('theme-select').value = prefs.theme;
  for (const b of document.querySelectorAll('[data-appearance-choice]'))
    b.setAttribute('aria-pressed', String(b.dataset.appearanceChoice === prefs.appearance));
  $('zoom-value').textContent = Math.round(prefs.zoom * 100) + '%';
  $('web-images').checked = prefs.webImages;
}

function setZoom(z) {
  prefs.zoom = Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));
  savePrefs();
  applyTheme();
}

/* ---------- documents ---------- */

let docs = [];
let activeId = null;
let seq = 0;
let pasteCount = 0;
const assets = new Map();       // images that came with the user's files: path -> { file, url }
const sampleAssets = new Map(); // images bundled with the samples
for (const [path, url] of Object.entries(DATA.assets)) sampleAssets.set(path, { url });

const current = () => docs.find((d) => d.id === activeId) || null;

// text is the file as last read or saved (line endings as in the file).
// Editing: draft is the editor's text (LF only) once the editor exists, and
// dirty says it differs from text. encoding and bom are how to write it back.
function makeDoc(fields) {
  return Object.assign({
    id: ++seq, name: '', path: '', kind: 'file', text: '', banner: '', encoding: 'utf-8', bom: false,
    handle: null, mtime: 0, size: 0, article: null, scroll: 0,
    editing: false, editor: null, editScroll: 0, draft: null, base: null, dirty: false, conflict: null,
  }, fields);
}

const sourceOf = (d) => (d.draft != null ? d.draft : d.text);

function metaOf(d) {
  if (d.kind === 'sample') return 'Sample';
  if (d.kind === 'paste') return 'Pasted text';
  if (d.kind === 'shared') return d.expires ? 'Shared · expires ' + shortDate(d.expires) : 'Shared';
  if (!('title' in d)) d.title = titleOf(sourceOf(d));
  return [dirName(d.path), d.title].filter(Boolean).join(' · ');
}

async function readText(file) {
  const r = decodeBytes(await file.arrayBuffer()); // lib.js: BOM, encoding
  if (!r.binary) r.banner = r.encoding === 'latin1' ? NOT_UTF8 : '';
  return r;
}

/* ---------- rendering one document ---------- */

function findAsset(d, src) {
  const pool = d.kind === 'sample' ? sampleAssets : assets;
  const { path } = splitHref(src);
  const want = resolvePath(dirName(d.path), path);
  let hit = pool.get(want);
  if (!hit) {
    const lower = want.toLowerCase();
    const name = baseName(lower);
    const byPath = [];
    const byName = [];
    for (const [p, a] of pool) {
      const pl = p.toLowerCase();
      if (pl === lower || pl.endsWith('/' + lower)) byPath.push(a);
      else if (baseName(pl) === name) byName.push(a);
    }
    hit = byPath[0] || (byName.length === 1 ? byName[0] : null);
  }
  if (!hit) return '';
  if (!hit.url) hit.url = URL.createObjectURL(hit.file);
  return hit.url;
}

function imageNote(img, text, title) {
  const note = el('span', 'mdw-img-note', text);
  note.title = title;
  img.replaceWith(note);
}

function prepImages(frag, d) {
  for (const img of frag.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    const alt = img.getAttribute('alt') || '';
    if (/^https?:\/\//i.test(src) || src.startsWith('//')) {
      if (prefs.webImages) {
        if (src.startsWith('//')) img.setAttribute('src', 'https:' + src);
        img.referrerPolicy = 'no-referrer';
      } else {
        imageNote(img, alt || 'web image', 'Web image, not loaded: ' + src + '\nTurn on "Load images from the web" in the sidebar to see it.');
      }
    } else if (/^data:image\//i.test(src)) {
      // embedded in the file itself: nothing to fetch
    } else if (!src || hasScheme(src)) {
      imageNote(img, alt || 'image', 'This image address cannot be loaded here: ' + src);
    } else {
      const url = findAsset(d, src);
      if (url) img.setAttribute('src', url);
      else imageNote(img, alt || baseName(src), 'Image not found among the open files: ' + src + '\nOpen its folder, or drop the image onto the page.');
    }
  }
}

function prepLinks(frag) {
  for (const a of frag.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) continue;
    if (href.startsWith('//')) a.setAttribute('href', 'https:' + href);
    if (/^(https?:|mailto:)/i.test(a.getAttribute('href'))) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else if (hasScheme(href)) {
      a.removeAttribute('href'); // unknown scheme: ignored, as in the app
    }
  }
}

/* code: the app colors fenced code with KSyntaxHighlighting; here highlight.js does it */

const scripts = new Map();
function loadScript(src, integrity) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      if (integrity) {
        s.integrity = integrity;
        s.crossOrigin = 'anonymous';
      }
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        scripts.delete(src); // offline now; try again with the next document
        reject(new Error('Could not load ' + src));
      };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

// The app's own alias table (highlight.cpp), plus names highlight.js files under another spelling.
const LANG_ALIAS = {
  shell: 'bash', sh: 'bash', console: 'bash', zsh: 'bash', 'c++': 'cpp', yml: 'yaml', make: 'makefile',
  tex: 'latex', patch: 'diff', docker: 'dockerfile', hs: 'haskell', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  ml: 'ocaml', jl: 'julia', ps1: 'powershell', ps: 'powershell', asm: 'x86asm', proto: 'protobuf', el: 'lisp',
  clj: 'clojure', fs: 'fsharp', viml: 'vim', objc: 'objectivec', 'objective-c': 'objectivec', f90: 'fortran',
  'c#': 'csharp', 'f#': 'fsharp',
};
// Languages highlight.js ships as separate files; fetched the first time a document uses one.
const EXTRA_LANGS = new Set(('1c abnf accesslog actionscript ada angelscript apache applescript arcade arduino armasm asciidoc '
  + 'aspectj autohotkey autoit avrasm awk axapta basic bnf brainfuck cal capnproto ceylon clean clojure clojure-repl cmake '
  + 'coffeescript coq cos crmsh crystal csp d dart delphi django dns dockerfile dos dsconfig dts dust ebnf elixir elm erb '
  + 'erlang erlang-repl excel fix flix fortran fsharp gams gauss gcode gherkin glsl gml golo gradle groovy haml handlebars '
  + 'haskell haxe hsp http hy inform7 irpf90 isbl jboss-cli julia julia-repl lasso latex ldif leaf lisp livecodeserver '
  + 'livescript llvm lsl mathematica matlab maxima mel mercury mipsasm mizar mojolicious monkey moonscript n1ql nestedtext '
  + 'nginx nim nix node-repl nsis ocaml openscad oxygene parser3 pf pgsql pony powershell processing profile prolog '
  + 'properties protobuf puppet purebasic q qml reasonml rib roboconf routeros rsl ruleslanguage sas scala scheme scilab '
  + 'smali smalltalk sml sqf stan stata step21 stylus subunit taggerscript tap tcl thrift tp twig vala vbscript '
  + 'vbscript-html verilog vhdl vim x86asm xl xquery zephir').split(' '));

async function highlightIn(article) {
  const blocks = [...article.querySelectorAll('pre.code[data-lang] > code')];
  if (!blocks.length) return;
  if (!window.hljs) {
    try { await loadScript(HLJS + 'highlight.min.js', HLJS_SRI); } catch (err) { return; }
  }
  const hljs = window.hljs;
  for (const code of blocks) {
    let lang = code.parentElement.dataset.lang.toLowerCase();
    lang = LANG_ALIAS[lang] || lang;
    if (!hljs.getLanguage(lang)) {
      if (!EXTRA_LANGS.has(lang)) continue; // unknown language: shown plain, as in the app
      try { await loadScript(`${HLJS}languages/${lang}.min.js`); } catch (err) { continue; }
      if (!hljs.getLanguage(lang)) continue;
    }
    try {
      code.innerHTML = hljs.highlight(code.textContent, { language: lang, ignoreIllegals: true }).value;
    } catch (err) { /* leave it plain */ }
  }
}

/* math: MathJax 4 with the options from the app's data/mathjax-helper.cjs */

let mathReady = null;
const mathCache = new Map(); // "D|tex" or "I|tex" -> finished <svg>, or an Error

function loadMath() {
  if (!mathReady) {
    window.MathJax = {
      startup: { typeset: false },
      tex: {
        packages: { '[+]': ['ams', 'noundefined'] },
        formatError: (jax, err) => { throw err; }, // report errors instead of drawing them
      },
      svg: { fontCache: 'local', linebreaks: { inline: false } },
      options: { enableEnrichment: false, enableSpeech: false, enableBraille: false, enableMenu: false },
    };
    mathReady = loadScript(MATHJAX, MATHJAX_SRI)
      .then(() => window.MathJax.startup.promise)
      .catch((err) => { mathReady = null; throw err; });
  }
  return mathReady;
}

function readMath(node) {
  const display = node.parentElement.classList.contains('math-display');
  const raw = node.textContent;
  const n = display ? 2 : 1; // the engine wraps the TeX in $ or $$
  return { display, tex: raw.slice(n, raw.length - n) };
}
const mathKey = (m) => (m.display ? 'D|' : 'I|') + m.tex;

async function texToSvg(m) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const svg = window.MathJax.tex2svg(m.tex, { display: m.display }).querySelector('svg');
      // Size from the viewBox in em (1000 units per em), as MathRenderer does,
      // so equations scale with the text whatever the body font's x-height is.
      const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number);
      const fluid = /%$/.test(svg.getAttribute('width') || '');
      if (vb.length === 4 && vb.every(Number.isFinite) && !fluid) {
        const [, minY, w, h] = vb;
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('style',
          `width:${(w / 1000).toFixed(3)}em;height:${(h / 1000).toFixed(3)}em;vertical-align:${(-(minY + h) / 1000).toFixed(3)}em`);
      }
      svg.setAttribute('class', 'math');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', m.tex);
      svg.removeAttribute('focusable');
      return svg;
    } catch (err) {
      if (err && err.retry) { await err.retry; continue; } // a font range had to load first
      throw new Error(String((err && err.message) || err));
    }
  }
  throw new Error('too many font loads');
}

function placeMath(node, result) {
  if (result instanceof Error) {
    node.className = 'math-error'; // TeX source in red, as in the app
    node.title = result.message;
  } else {
    const svg = result.cloneNode(true);
    for (const k of ['s', 'e']) if (node.dataset[k] != null) svg.dataset[k] = node.dataset[k]; // the formatting toolbar's source map
    node.replaceWith(svg);
  }
}

async function typesetIn(article) {
  const todo = [];
  for (const node of article.querySelectorAll('code.math-pending')) {
    const hit = mathCache.get(mathKey(readMath(node)));
    if (hit) placeMath(node, hit); // already rendered once: instant, like the app's cache
    else todo.push(node);
  }
  if (!todo.length) return;
  try {
    await loadMath();
  } catch (err) {
    for (const node of todo) node.className = 'math-source'; // no MathJax: show the TeX
    return;
  }
  let sliceStart = performance.now();
  for (const node of todo) {
    const m = readMath(node);
    const key = mathKey(m);
    if (!mathCache.has(key)) {
      try { mathCache.set(key, await texToSvg(m)); } catch (err) { mathCache.set(key, err); }
    }
    placeMath(node, mathCache.get(key));
    if (performance.now() - sliceStart > 40) {
      await new Promise((r) => setTimeout(r));
      sliceStart = performance.now();
    }
  }
}

// mapped: with the source map, for the formatting toolbar. It renders the
// text the toolbar edits (line endings normalized), which looks the same.
function buildArticle(d, mapped = false) {
  const article = el('article', 'markdown-body');
  const text = mapped ? editText(d) : sourceOf(d);
  let html;
  try {
    html = mapped ? engine.renderMapped(text) : engine.render(text);
  } catch (err) {
    html = '<h1>This file could not be rendered</h1>\n<p><code></code></p>';
    article.dataset.error = String((err && err.message) || err);
  }
  // A template's content is inert: images do not start loading until the
  // nodes are moved into the page, after their addresses have been checked.
  // The engine escapes raw HTML (md4c's NOHTML flag), so this is markup it wrote.
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  if (article.dataset.error) tpl.content.querySelector('code').textContent = article.dataset.error;
  prepLinks(tpl.content);
  prepImages(tpl.content, d);
  if (mapped) for (const n of tpl.content.querySelectorAll('a, img')) n.draggable = false; // drag selects text instead
  if (d.banner) article.append(el('div', 'banner', d.banner));
  article.append(tpl.content);
  if (!text.trim()) article.append(el('p', 'mdw-note', 'This file is empty.'));
  highlightIn(article);
  typesetIn(article);
  d.articleMapped = mapped;
  return article;
}

/* ---------- showing documents ---------- */

// The document as it is now: rendered, or its source in the editor (Edit mode).
function showDoc(d) {
  host.classList.toggle('editing', d.editing);
  host.classList.toggle('formatting', prefs.toolbar && !d.editing);
  if (d.editing) {
    const ta = editorOf(d);
    page.replaceChildren(ta);
    ta.scrollTop = d.editScroll;
  } else {
    if (!d.article || d.articleMapped !== prefs.toolbar) d.article = buildArticle(d, prefs.toolbar);
    page.replaceChildren(d.article);
  }
  pageSel = null;
  scheduleFormatState();
}

// Remembers where the document is scrolled before something else is shown.
function leaveDoc(d) {
  if (d.article && d.article.isConnected) d.scroll = host.scrollTop;
  if (d.editor && d.editor.isConnected) {
    d.editScroll = d.editor.scrollTop;
    syncDraft(d);
  }
}

// Keys go to the document: the editor in Edit mode, else the page (to scroll).
function focusDoc() {
  const d = current();
  if (d && d.editing) d.editor.focus({ preventScroll: true });
  else host.focus({ preventScroll: true });
}

function findAnchor(d, frag) {
  if (!d.article || !frag) return null;
  const byId = (id) => d.article.querySelector(`[id="${CSS.escape(id)}"]`);
  let target = byId(frag);
  if (!target) {
    try { target = byId(engine.slugify(frag)); } catch (err) { /* engine restarting */ }
  }
  return target;
}

function scrollToAnchor(d, frag) {
  const target = findAnchor(d, frag);
  if (target) host.scrollTop += target.getBoundingClientRect().top - host.getBoundingClientRect().top - 12;
  return !!target;
}

function activateDoc(id, opts = {}) {
  const prev = current();
  if (prev) leaveDoc(prev);
  activeId = id;
  const d = current();
  if (d && opts.anchor) d.editing = false; // a link led here: show where it points (the draft stays)
  renderRail();
  renderBar();
  if (!d) {
    page.replaceChildren();
    host.classList.remove('editing', 'formatting');
    host.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  host.hidden = false;
  emptyEl.hidden = true;
  restoreEmptyMessage();
  showDoc(d);
  if (!d.editing) host.scrollTop = d.scroll;
  if (opts.anchor) scrollToAnchor(d, opts.anchor);
  if (d.handle) checkFresh(d);
}

function closeDoc(id) {
  const i = docs.findIndex((d) => d.id === id);
  if (i < 0) return;
  const d = docs[i];
  if (d.editor) syncDraft(d);
  if (d.dirty && !confirm(`${d.name} has unsaved changes. Close it and lose them?`)) return;
  docs.splice(i, 1);
  if (id === activeId) {
    const next = docs[i] || docs[i - 1] || null;
    activeId = null;
    activateDoc(next ? next.id : null);
  } else {
    renderRail();
  }
}

function step(delta) {
  if (docs.length < 2) return;
  const i = docs.findIndex((d) => d.id === activeId);
  activateDoc(docs[(i + delta + docs.length) % docs.length].id);
}

function renderRail() {
  const hadFocus = listEl.contains(document.activeElement);
  let activeButton = null;
  listEl.replaceChildren(...docs.map((d) => {
    const li = el('li', 'file' + (d.id === activeId ? ' is-active' : ''));
    const main = el('button', 'file-main');
    main.type = 'button';
    main.title = d.path || d.name;
    const name = el('span', 'file-name');
    if (d.dirty) name.append(el('span', 'dirty-dot', '• '));
    name.append(d.name);
    main.append(name);
    const meta = metaOf(d);
    if (meta) main.append(el('span', 'file-meta', meta));
    if (d.dirty) main.title += ' (unsaved changes)';
    if (d.id === activeId) {
      main.setAttribute('aria-current', 'page');
      activeButton = main;
    }
    main.addEventListener('click', (e) => {
      activateDoc(d.id);
      if (narrow.matches) setRail(false);
      if (e.detail) focusDoc(); // mouse: keys now go to the document
    });
    li.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      closeDoc(d.id);
    });
    const close = el('button', 'file-close', '×');
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close ' + d.name);
    close.addEventListener('click', () => closeDoc(d.id));
    li.append(main, close);
    return li;
  }));
  $('files-count').textContent = String(docs.length);
  $('files-hint').hidden = docs.length > 0;
  if (hadFocus && activeButton) activeButton.focus({ preventScroll: true });
}

const SAVE_LABEL = { inplace: 'Save', as: 'Save as…', download: 'Download' };

function renderBar() {
  const d = current();
  const dot = d && d.dirty ? '• ' : '';
  $('bar-name').textContent = d ? dot + d.name : 'No file open';
  $('bar-path').textContent = d ? dirName(d.path) : '';
  $('live').hidden = !(d && d.handle);
  document.title = (d ? dot + d.name + ' · ' : '') + 'md-whatever Reader';
  const mode = $('mode');
  mode.hidden = !d;
  const fmt = $('format-toggle');
  fmt.hidden = !d;
  fmt.setAttribute('aria-pressed', String(prefs.toolbar));
  $('format').hidden = !(d && prefs.toolbar);
  if (!d || !prefs.toolbar) $('fmt-link').hidden = true;
  $('share').hidden = !(hosted && d);
  if (sharePanelFor && (!d || d.id !== sharePanelFor)) renderSharePanel(); // another document: close it
  const save = $('save');
  save.hidden = !(d && d.dirty);
  if (d) {
    mode.textContent = d.editing ? 'Read' : 'Edit';
    mode.title = d.editing ? 'Back to reading (Esc)' : 'Edit the Markdown source (e)';
    const kind = saveKind(d);
    save.textContent = SAVE_LABEL[kind];
    save.title = kind === 'inplace' ? `Save to ${d.name} (${MOD}S)`
      : kind === 'as' ? `Save to a file you pick (${MOD}S)` : `Download a copy (${MOD}S)`;
  }
  const conflict = !!(d && d.conflict === 'shown');
  $('conflict').hidden = !conflict;
  if (conflict) $('conflict-text').textContent = `${d.name} changed on disk while you were editing it.`;
}

function setRail(open) {
  app.classList.toggle('rail-open', open);
  $('rail-toggle').setAttribute('aria-expanded', String(open));
}

/* ---------- live reload ---------- */

// New contents from disk (r: from readText) become the document's.
function adopt(d, r) {
  const old = d.editor;
  const refocus = !!old && root.activeElement === old;
  d.text = r.text;
  d.banner = r.banner;
  d.encoding = r.encoding;
  d.bom = r.bom;
  d.base = null;
  d.article = null;
  d.conflict = null;
  delete d.title;
  if (old && d.draft !== baseOf(d)) {
    // An editor's text is set only once (setting it again would wipe its undo
    // history), so new text means a new editor, at the same place.
    d.caret = old.selectionStart;
    if (old.isConnected) d.editScroll = old.scrollTop;
    d.editor = null;
    d.draft = null;
  } else if (!old) {
    d.draft = null; // a draft from the formatting toolbar, which has no editor of its own
  }
  d.dirty = false;
  if (d.id === activeId) {
    if (!d.editing) {
      const keep = host.scrollTop; // keep your place, as the app does
      showDoc(d);
      host.scrollTop = keep;
    } else if (d.editor !== old) {
      showDoc(d);
      if (refocus) d.editor.focus({ preventScroll: true });
    }
  }
  renderRail();
  renderBar();
}

async function refreshDoc(d, file) {
  if (!file) file = await d.handle.getFile();
  const r = await readText(file);
  d.mtime = file.lastModified;
  d.size = file.size;
  if (r.binary || (r.text === d.text && r.banner === d.banner)) return false;
  if (d.editor) syncDraft(d);
  if (d.dirty && normalizeNewlines(r.text) !== d.draft) {
    // Unsaved changes are never replaced. Say so, and let the reader choose.
    d.conflict = 'shown';
    renderBar();
    return false;
  }
  adopt(d, r);
  return true;
}

async function checkFresh(d) {
  if (!d.handle || d.checking || d.saving) return false;
  d.checking = true;
  try {
    const file = await d.handle.getFile();
    if (file.lastModified !== d.mtime || file.size !== d.size) return await refreshDoc(d, file);
  } catch (err) {
    /* moved, deleted or permission withdrawn: keep showing what we have */
  } finally {
    d.checking = false;
  }
  return false;
}

setInterval(() => {
  const d = current();
  if (d && d.handle && !document.hidden) checkFresh(d);
}, 1000);

// Back to what is on disk, dropping unsaved changes.
async function reloadFromDisk(d) {
  try {
    const file = await d.handle.getFile();
    const r = await readText(file);
    if (r.binary) throw new Error('it is no longer a text file');
    d.mtime = file.lastModified;
    d.size = file.size;
    adopt(d, r);
  } catch (err) {
    toast(`Could not read ${d.name}: ${(err && err.message) || err}`);
  }
}

async function reloadCurrent() {
  const d = current();
  if (!d) return;
  if (!d.handle) {
    toast(d.kind === 'file' ? 'This browser cannot re-read the file. Open it again to refresh it.' : 'Nothing to reload for ' + d.name + '.');
    return;
  }
  if (d.editor) syncDraft(d);
  if (d.dirty) {
    if (confirm(`Discard your changes to ${d.name} and reload it from disk?`)) await reloadFromDisk(d);
    return;
  }
  toast((await checkFresh(d)) ? 'Reloaded ' + d.name : d.name + ' is up to date');
}

/* ---------- editing ---------- */

const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn'] } }];
let saveNoteShown = false;

// The file's text as the editor holds it (LF only): what "no changes" means.
const baseOf = (d) => (d.base != null ? d.base : (d.base = normalizeNewlines(d.text)));

// How Save works for a document: 'inplace' (Chromium: a file it may write to),
// 'as' (Chromium: to a file the reader picks), 'download' (Safari, Firefox).
function saveKind(d) {
  if (d.kind === 'file' && d.handle && 'createWritable' in d.handle) return 'inplace';
  return window.showSaveFilePicker ? 'as' : 'download';
}

function editorOf(d) {
  if (!d.editor) {
    const ta = document.createElement('textarea');
    ta.className = 'mdw-editor';
    ta.spellcheck = false;
    for (const [k, v] of [['autocapitalize', 'off'], ['autocomplete', 'off'], ['autocorrect', 'off'], ['aria-label', 'Markdown source']])
      ta.setAttribute(k, v);
    ta.value = sourceOf(d); // the only time .value is set: setting it wipes the undo history
    if (d.caret != null) ta.setSelectionRange(d.caret, d.caret);
    d.caret = null;
    ta.addEventListener('input', () => { noteEdit(d); scheduleFormatState(); });
    ta.addEventListener('keydown', (e) => editorKey(e, d));
    for (const type of ['keyup', 'mouseup', 'select', 'focus']) ta.addEventListener(type, scheduleFormatState);
    d.editor = ta;
  }
  return d.editor;
}

// Reading the editor's text costs a copy of it, so typing fast reads it at most
// every 150 ms. The first change shows the unsaved dot at once.
function noteEdit(d) {
  d.article = null; // Read renders the draft
  clearTimeout(d.syncTimer);
  if (d.dirty) d.syncTimer = setTimeout(() => syncDraft(d), 150);
  else syncDraft(d);
}

function syncDraft(d) {
  clearTimeout(d.syncTimer);
  if (!d.editor) return;
  const draft = d.editor.value;
  if (draft === d.draft) return;
  d.draft = draft;
  delete d.title;
  const dirty = draft !== baseOf(d);
  if (dirty !== d.dirty) {
    d.dirty = dirty;
    renderRail();
    renderBar();
  }
}

function editorKey(e, d) {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && !e.shiftKey) {
    e.preventDefault();
    setEditing(d, false);
  } else if (e.key === 'Tab' && !e.shiftKey) {
    // Two spaces. Shift+Tab still moves focus on, and Esc goes back to reading,
    // so the keyboard is never stuck in here.
    e.preventDefault();
    const ta = e.target;
    if (!document.execCommand('insertText', false, '  ')) { // execCommand keeps undo working
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      noteEdit(d);
    }
  }
}

const scrollRatio = (node) => {
  const room = node.scrollHeight - node.clientHeight;
  return room > 0 ? node.scrollTop / room : 0;
};
const scrollToRatio = (node, ratio) => { node.scrollTop = ratio * (node.scrollHeight - node.clientHeight); };

// Read <-> Edit for the current document. Scrolling carries over by ratio,
// which is close but not exact (rendered and source heights differ).
function setEditing(d, on) {
  if (!d || d.id !== activeId) return;
  if (d.editing === on) {
    if (on) d.editor.focus({ preventScroll: true });
    return;
  }
  if (on) {
    const ratio = scrollRatio(host);
    const sameSpot = d.readTop != null && Math.abs(host.scrollTop - d.readTop) < 4;
    d.scroll = host.scrollTop;
    d.editing = true;
    showDoc(d);
    const ta = d.editor;
    if (!sameSpot) { // back where it was left otherwise
      const text = ta.value;
      const at = text.lastIndexOf('\n', Math.round(ratio * text.length) - 1) + 1; // start of a line
      ta.setSelectionRange(at, at);
      scrollToRatio(ta, ratio);
    }
    ta.focus({ preventScroll: true });
    if (!saveNoteShown && d.kind === 'file' && saveKind(d) === 'download') {
      saveNoteShown = true;
      toast("This browser can't save to the original file. Save downloads a copy. Chrome, Edge, Arc or Brave can save in place.", 9000);
    }
  } else {
    syncDraft(d);
    const ratio = scrollRatio(d.editor);
    d.editScroll = d.editor.scrollTop;
    d.editing = false;
    showDoc(d);
    scrollToRatio(host, ratio);
    d.readTop = host.scrollTop;
    host.focus({ preventScroll: true });
  }
  renderBar();
}

async function writeTo(handle, blob) {
  const w = await handle.createWritable(); // written to a temporary file, swapped in on close
  try {
    await w.write(blob);
    await w.close();
  } catch (err) {
    await w.abort().catch(() => {});
    throw err;
  }
}

function download(blob, name) {
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
}

// Saves the document: in place, to a picked file (as, or nowhere to write it
// back to), or as a download. Unchanged text is written back exactly as it was
// read; edited text keeps the file's line endings, BOM and encoding.
async function save(d, { as = false } = {}) {
  if (!d || d.saving) return false;
  if (d.editor) syncDraft(d);
  const kind = as ? (window.showSaveFilePicker ? 'as' : 'download') : saveKind(d);
  if (kind === 'inplace' && !d.dirty) {
    toast('No changes to save.');
    return false;
  }
  const edited = d.draft != null && d.draft !== baseOf(d);
  const text = edited ? withLineEnding(d.draft, lineEnding(d.text)) : d.text;
  let encoding = d.encoding;
  let out = encodeText(text, d);
  if (out.unencodable) {
    if (!confirm(`${d.name} is saved as Latin-1, which has no "${out.unencodable}".\n\nSave it as UTF-8 instead? That changes the file's encoding.`)) return false;
    encoding = 'utf-8';
    out = encodeText(text, { encoding });
  }
  const blob = new Blob([out.bytes], { type: 'text/markdown' });
  d.saving = true; // the live-reload check leaves the file alone meanwhile
  try {
    if (kind === 'inplace') {
      if (d.conflict && !confirm(`${d.name} changed on disk since you started editing it. Replace it with your version?`)) return false;
      // Opening asked only to read. Writing is asked for on the first save.
      let state = await d.handle.queryPermission({ mode: 'readwrite' });
      if (state !== 'granted') state = await d.handle.requestPermission({ mode: 'readwrite' });
      if (state !== 'granted') {
        toast(`Not saved: the browser was not allowed to write to ${d.name}.`);
        return false;
      }
      await writeTo(d.handle, blob);
    } else if (kind === 'as') {
      let handle;
      try {
        handle = await window.showSaveFilePicker({ suggestedName: d.name, types: MD_TYPES });
      } catch (err) {
        if (err && err.name === 'AbortError') return false;
        throw err;
      }
      await writeTo(handle, blob);
      // From now on the document is that file: saved in place, and watched.
      Object.assign(d, { kind: 'file', handle, name: handle.name, path: handle.name });
      recent.add(handle);
    } else {
      download(blob, d.name);
    }
    if (kind !== 'download') {
      const file = await d.handle.getFile();
      d.mtime = file.lastModified; // so live reload doesn't take our own save for a change
      d.size = file.size;
    }
    if (encoding !== d.encoding) {
      Object.assign(d, { encoding, bom: false, banner: '', article: null });
    }
    d.text = text;
    d.base = null;
    d.conflict = null;
    d.dirty = false;
    if (d.editor) syncDraft(d); // typing during the save leaves it dirty again
    renderRail();
    renderBar();
    toast(kind === 'download' ? `Downloaded ${d.name}. The original file is unchanged.` : `Saved ${d.name}.`);
    return true;
  } catch (err) {
    toast(`Could not save ${d.name}: ${(err && err.message) || err}`);
    return false;
  } finally {
    d.saving = false;
  }
}

/* ---------- formatting toolbar ----------
   Formatting changes the Markdown source with lib.js's operations; this part
   finds what they work on. In Read mode, the page is rendered with the
   engine's source map (web/engine.h), and the selection is turned into source
   offsets and back. In Edit mode, the textarea's selection is used as it is. */

// The text formatting works on: the draft, or the file with LF line endings.
const editText = (d) => (d.draft != null ? d.draft : baseOf(d));

const INLINE_TAGS = { STRONG: 'strong', EM: 'em', DEL: 'del', CODE: 'code', A: 'link' };
const MATH_SEL = 'code.math-pending, code.math-error, code.math-source, svg.math, span.math-display';
const LEAVES = 'span[data-s]:not([data-e]), [data-e]'; // mapped text runs, code blocks, math (never nested)

function inlineKind(node) {
  if (node.nodeType !== 1) return null;
  if (node.matches(MATH_SEL)) return 'math';
  if (node.tagName === 'CODE' && node.parentElement && node.parentElement.tagName === 'PRE') return null;
  return INLINE_TAGS[node.tagName] || null;
}

// Inline elements of a mapped render, with their source ranges: { kind, s, cs,
// ce, e } (whole, content). One that can't be placed exactly (an image or a
// footnote mark inside, say) is opaque: formatting goes around it, not into it.
function inlineElements(container, text) {
  const out = [];
  const memo = new Map();
  const NONE = 0; // a node with no source of its own (a line break)
  const range = (node) => {
    if (node.nodeType !== 1) return NONE;
    if (memo.has(node)) return memo.get(node);
    let r = NONE;
    const kind = inlineKind(node);
    if (node.tagName === 'SPAN' && node.hasAttribute('data-s') && !node.hasAttribute('data-e')) {
      const s = Number(node.dataset.s);
      r = [s, s + (node.hasAttribute('data-n') ? Number(node.dataset.n) : node.textContent.length)];
    } else if (kind === 'math') {
      if (node.hasAttribute('data-e')) {
        const cs = Number(node.dataset.s);
        const ce = Number(node.dataset.e);
        const o = inlineOuter(text, 'math', cs, ce);
        if (o) out.push({ kind, s: o.s, cs, ce, e: o.e });
        r = o ? [o.s, o.e] : null;
      }
    } else if (node.tagName === 'IMG' || node.tagName === 'SUP' || node.classList.contains('mdw-img-note')) {
      r = null;
    } else {
      let lo = Infinity;
      let hi = -Infinity;
      let unknown = false;
      for (const child of node.childNodes) {
        const c = range(child);
        if (c === null) unknown = true;
        else if (c) {
          lo = Math.min(lo, c[0]);
          hi = Math.max(hi, c[1]);
        }
      }
      if (kind && lo <= hi) {
        const o = unknown ? null : inlineOuter(text, kind, lo, hi);
        if (o) out.push({ kind, cs: lo, ce: hi, ...o });
        else out.push({ kind, s: lo, cs: lo, ce: hi, e: hi, opaque: true });
        r = o ? [o.s, o.e] : null;
      } else {
        r = unknown ? null : lo <= hi ? [lo, hi] : NONE;
      }
    }
    memo.set(node, r);
    return r;
  };
  for (const node of container.querySelectorAll('strong, em, del, code, a, span.math-display')) range(node);
  return out;
}

// The inline elements of a text: from the page when it shows that text with
// the source map (Read mode), else from a render nobody sees. Cached by text.
let structCache = { text: null, els: [] };
function structure(text) {
  if (structCache.text !== text) {
    const d = current();
    let container = d && !d.editing && d.articleMapped && d.article && editText(d) === text ? d.article : null;
    if (!container) {
      const tpl = document.createElement('template');
      tpl.innerHTML = engine.renderMapped(text);
      container = tpl.content;
    }
    structCache = { text, els: inlineElements(container, text) };
  }
  return structCache.els;
}

/* the rendered page <-> the source */

const rangeBetween = (n1, o1, n2, o2) => {
  const r = document.createRange();
  r.setStart(n1, o1);
  r.setEnd(n2, o2);
  return r;
};

// A leaf's source range: a text run, or the content of a code block or math.
function leafRange(leaf) {
  const s = Number(leaf.dataset.s);
  if (leaf.hasAttribute('data-e')) return [s, Number(leaf.dataset.e)];
  return [s, s + (leaf.hasAttribute('data-n') ? Number(leaf.dataset.n) : leaf.textContent.length)];
}
// Math counts with its dollars.
function atomRange(leaf, text) {
  const [cs, ce] = leafRange(leaf);
  const o = leaf.matches(MATH_SEL) ? inlineOuter(text, 'math', cs, ce) : null;
  return o ? [o.s, o.e] : [cs, ce];
}

// A point of the page (node, offset) as a source offset. side: 'start' or
// 'end' of a selection, for points between pieces of text.
function pointToSource(article, text, node, offset, side) {
  const elem = node.nodeType === 1 ? node : node.parentElement;
  const span = elem && elem.closest('span[data-s]:not([data-e])');
  if (span && article.contains(span)) {
    const s = Number(span.dataset.s);
    const k = rangeBetween(span, 0, node, offset).toString().length;
    if (span.hasAttribute('data-n')) return k === 0 ? s : s + Number(span.dataset.n); // an entity or escape is one piece
    return s + k;
  }
  const pre = elem && elem.closest('pre[data-s]');
  if (pre && article.contains(pre)) { // code: the start of that line
    const lines = (rangeBetween(pre, 0, node, offset).toString().match(/\n/g) || []).length;
    let p = Number(pre.dataset.s);
    for (let i = 0; i < lines; i++) {
      const n = text.indexOf('\n', p);
      if (n < 0 || n >= Number(pre.dataset.e)) break;
      p = n + 1;
    }
    return p;
  }
  const atom = elem && elem.closest('[data-e]');
  if (atom && article.contains(atom)) {
    const [s, e] = atomRange(atom, text);
    return side === 'start' ? s : e;
  }
  // Between pieces: the next one's start, or the previous one's end.
  const leaves = article.querySelectorAll(LEAVES);
  if (!leaves.length) return 0;
  const at = document.createRange();
  at.setStart(node, offset);
  let lo = 0;
  let hi = leaves.length;
  while (lo < hi) { // first leaf at or after the point
    const mid = (lo + hi) >> 1;
    if (at.comparePoint(leaves[mid], 0) >= 0) hi = mid;
    else lo = mid + 1;
  }
  if (side === 'start') return lo < leaves.length ? atomRange(leaves[lo], text)[0] : atomRange(leaves[leaves.length - 1], text)[1];
  return lo > 0 ? atomRange(leaves[lo - 1], text)[1] : atomRange(leaves[0], text)[0];
}

// The other way, to put the selection back after the page was re-rendered.
function sourceToPoint(article, text, pos, side) {
  let best = null;
  for (const leaf of article.querySelectorAll(LEAVES)) {
    const [s, e] = leaf.matches('span[data-s]:not([data-e])') ? leafRange(leaf) : atomRange(leaf, text);
    if (s <= pos && pos <= e && (side === 'start' ? pos < e || s === e : pos > s || s === e)) {
      if (leaf.hasAttribute('data-e') || leaf.hasAttribute('data-n')) {
        const i = [...leaf.parentNode.childNodes].indexOf(leaf);
        return pos === s ? { node: leaf.parentNode, offset: i } : { node: leaf.parentNode, offset: i + 1 };
      }
      let k = pos - s;
      const walk = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
      let t = null;
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        t = n;
        if (k <= n.length) return { node: n, offset: k };
        k -= n.length;
      }
      return t ? { node: t, offset: t.length } : { node: leaf, offset: 0 };
    }
    // Not inside: remember the nearest on the right side of pos.
    if (side === 'start' ? s >= pos && (!best || s < best.d) : e <= pos && (!best || e > best.d))
      best = { leaf, d: side === 'start' ? s : e };
  }
  if (!best) return { node: article, offset: side === 'start' ? 0 : article.childNodes.length };
  const i = [...best.leaf.parentNode.childNodes].indexOf(best.leaf);
  return { node: best.leaf.parentNode, offset: side === 'start' ? i : i + 1 };
}

// The page's selection, through the shadow root: { a, b } in the source, or null.
function readPageSelection(d) {
  const article = d.article;
  if (!article || !article.isConnected) return null;
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let r = null;
  if (sel.getComposedRanges) {
    try { r = sel.getComposedRanges({ shadowRoots: [root] })[0]; } catch (err) {
      try { r = sel.getComposedRanges(root)[0]; } catch (err2) { r = null; }
    }
  }
  if ((!r || !article.contains(r.startContainer)) && root.getSelection) {
    const own = root.getSelection();
    if (own && own.rangeCount) r = own.getRangeAt(0);
  }
  if (!r) r = sel.getRangeAt(0);
  const inStart = article.contains(r.startContainer);
  const inEnd = article.contains(r.endContainer);
  if (!inStart && !inEnd) return null;
  const text = editText(d);
  const a = inStart ? pointToSource(article, text, r.startContainer, r.startOffset, 'start') : 0;
  const b = inEnd ? pointToSource(article, text, r.endContainer, r.endOffset, 'end') : text.length;
  return { a: Math.min(a, b), b: Math.max(a, b) };
}

function setPageSelection(d, a, b) {
  const text = editText(d);
  const start = sourceToPoint(d.article, text, a, 'start');
  const end = a === b ? start : sourceToPoint(d.article, text, b, 'end');
  try {
    document.getSelection().setBaseAndExtent(start.node, start.offset, end.node, end.offset);
  } catch (err) { /* the selection stays where it was */ }
  pageSel = { id: d.id, text, a, b };
}

// The last selection made in the page (Read mode). Kept while the focus is in
// the toolbar (its URL field, the block menu), which would clear the page's own.
let pageSel = null;
document.addEventListener('selectionchange', () => {
  if (!prefs.toolbar) return;
  const d = current();
  if (!d || d.editing) return;
  const r = readPageSelection(d);
  if (r) {
    pageSel = { id: d.id, text: editText(d), ...r };
    scheduleFormatState();
  }
});

/* actions */

const INLINE_ACTIONS = new Set(['strong', 'em', 'del', 'code']);

function runFormat(text, a, b, action, arg, empty) {
  if (action === 'codeblock') return applyBlock(text, a, b, 'code');
  if (INLINE_ACTIONS.has(action)) return toggleInline(text, a, b, action, structure(text), { empty });
  if (action === 'link') return setLink(text, a, b, arg, structure(text));
  if (action === 'unlink') return removeLink(text, a, b, structure(text));
  return applyBlock(text, a, b, action);
}

// Where an action applies: { d, text, a, b }, or null after saying why not.
function formatTarget() {
  const d = current();
  if (!d) return null;
  if (d.editing) {
    syncDraft(d);
    const ta = d.editor;
    return { d, text: ta.value, a: ta.selectionStart, b: ta.selectionEnd };
  }
  const text = editText(d);
  if (!pageSel || pageSel.id !== d.id || pageSel.text !== text) {
    toast('Select some text in the document first, or click where the change should go.');
    return null;
  }
  return { d, text, a: pageSel.a, b: pageSel.b };
}

function format(action, arg) {
  const t = formatTarget();
  if (!t) return false;
  const r = runFormat(t.text, t.a, t.b, action, arg, t.d.editing);
  if (r.error) {
    toast(r.error);
    return false;
  }
  if (t.d.editing) replaceInEditor(t.d, t.text, r);
  else if (r.text !== t.text) commitPage(t.d, t.text, r, [t.a, t.b]);
  else setPageSelection(t.d, r.a, r.b);
  scheduleFormatState();
  return true;
}

// Edit mode: one native edit, so Ctrl+Z undoes the whole action.
function replaceInEditor(d, before, r) {
  const ta = d.editor;
  if (r.text !== before) {
    const { start, oldEnd, newEnd } = textDiff(before, r.text);
    const ins = r.text.slice(start, newEnd);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, oldEnd);
    const ok = ins ? document.execCommand('insertText', false, ins) : document.execCommand('delete');
    if (!ok && ta.value === before) ta.setRangeText(ins, start, oldEnd); // no execCommand: right text, no undo step
  }
  ta.setSelectionRange(r.a, r.b);
  ta.focus({ preventScroll: true });
  noteEdit(d);
}

// The draft as the toolbar left it. The source editor, if one was made, is
// replaced next time (setting a textarea's text would wipe its undo history
// anyway), the way live reload replaces it.
function setDraftText(d, text, caret) {
  if (d.editor) {
    d.editor = null;
    d.caret = caret;
  }
  d.draft = text;
  delete d.title;
  d.dirty = text !== baseOf(d);
  renderRail();
  renderBar();
}

function rerenderPage(d, a, b) {
  const keep = host.scrollTop;
  d.article = buildArticle(d, true);
  page.replaceChildren(d.article);
  host.scrollTop = keep;
  setPageSelection(d, a, b);
}

// Read mode: undo is the toolbar's own, one step per action.
function commitPage(d, before, r, selBefore) {
  const h = d.history || (d.history = { undo: [], redo: [] });
  const top = h.undo[h.undo.length - 1];
  if (top && top.after !== before) h.undo = []; // the text changed some other way since
  h.undo.push({ before, after: r.text, selBefore, selAfter: [r.a, r.b] });
  if (h.undo.length > 200) h.undo.shift();
  h.redo = [];
  setDraftText(d, r.text, r.a);
  rerenderPage(d, r.a, r.b);
}

function undoFormat(redo) {
  const d = current();
  if (!d) return;
  if (d.editing) {
    d.editor.focus({ preventScroll: true });
    document.execCommand(redo ? 'redo' : 'undo');
    return;
  }
  const h = d.history;
  const from = h && (redo ? h.redo : h.undo);
  const step = from && from[from.length - 1];
  const now = editText(d);
  if (!step || (redo ? step.before : step.after) !== now) {
    if (h) h.undo = h.redo = [];
    toast(redo ? 'Nothing to redo.' : 'Nothing to undo here. Changes made in Edit are undone there.');
    return;
  }
  from.pop();
  (redo ? h.undo : h.redo).push(step);
  const [a, b] = redo ? step.selAfter : step.selBefore;
  setDraftText(d, redo ? step.after : step.before, a);
  rerenderPage(d, a, b);
  scheduleFormatState();
}

/* the link field */

let linkTarget = null; // where the link goes: { id, text, a, b }, fixed when the field opens

function openLinkField() {
  const t = formatTarget();
  if (!t) return;
  linkTarget = { id: t.d.id, editing: t.d.editing, text: t.text, a: t.a, b: t.b };
  const link = structure(t.text).filter((x) => x.kind === 'link' && !x.opaque && x.s <= t.a && t.b <= x.e)
    .sort((x, y) => (x.e - x.s) - (y.e - y.s))[0];
  let url = '';
  if (link) url = link.ds != null ? t.text.slice(link.ds, link.de).replace(/^<(.*)>$/s, '$1') : link.ref ? '' : t.text.slice(link.cs, link.ce);
  const input = $('fmt-url');
  input.value = url;
  $('fmt-unlink').hidden = !link;
  $('fmt-link').hidden = false;
  input.focus();
  input.select();
}

function closeLinkField(refocus = true) {
  $('fmt-link').hidden = true;
  linkTarget = null;
  if (refocus) focusDoc();
}

function applyLinkField(remove) {
  const t = linkTarget;
  const d = current();
  closeLinkField();
  if (!t || !d || d.id !== t.id || d.editing !== t.editing) return;
  const now = d.editing ? (syncDraft(d), d.editor.value) : editText(d);
  if (now !== t.text) {
    toast('The document changed meanwhile. Select the text again.');
    return;
  }
  const r = remove ? removeLink(t.text, t.a, t.b, structure(t.text)) : setLink(t.text, t.a, t.b, $('fmt-url').value, structure(t.text));
  if (r.error) {
    toast(r.error);
    return;
  }
  if (d.editing) replaceInEditor(d, t.text, r);
  else commitPage(d, t.text, r, [t.a, t.b]);
  scheduleFormatState();
}

/* the toolbar itself */

function setToolbar(on) {
  prefs.toolbar = on;
  savePrefs();
  renderBar();
  const d = current();
  if (d && !d.editing) {
    const keep = host.scrollTop;
    showDoc(d); // re-rendered with (or without) the source map
    host.scrollTop = keep;
  } else if (d) {
    host.classList.toggle('formatting', false);
  }
  if (on && d) focusDoc();
}

// Buttons show what the selection is: bold, in a list, a heading...
let stateTimer = 0;
function scheduleFormatState() {
  if (!prefs.toolbar) return;
  clearTimeout(stateTimer);
  stateTimer = setTimeout(updateFormatState, 80);
}

function updateFormatState() {
  const d = current();
  if (!d || !prefs.toolbar) return;
  let text;
  let a;
  let b;
  if (d.editing) {
    if (!d.editor) return;
    text = d.editor.value;
    a = d.editor.selectionStart;
    b = d.editor.selectionEnd;
  } else {
    text = editText(d);
    const ok = pageSel && pageSel.id === d.id && pageSel.text === text;
    a = ok ? pageSel.a : -1;
    b = ok ? pageSel.b : -1;
  }
  const pressed = new Set();
  let block = 'p';
  if (a >= 0) {
    if (text.length < 300000) { // a long document in Edit mode: not on every keystroke
      for (const x of structure(text)) if (!x.opaque && x.s <= a && b <= x.e) pressed.add(x.kind);
    }
    const at = blockAt(text, a);
    block = at.block === 'code' ? 'codeblock' : at.block === 'fm' ? 'p' : at.block;
    if (at.block === 'code') pressed.add('codeblock');
    if (at.list) pressed.add(at.list);
    if (at.quote) pressed.add('quote');
  }
  for (const btn of document.querySelectorAll('#format [data-fmt]')) {
    if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', String(pressed.has(btn.dataset.fmt)));
  }
  const select = $('fmt-block');
  select.querySelector('[value="codeblock"]').hidden = block !== 'codeblock';
  select.value = block;
}

function bindToolbar() {
  $('format-toggle').addEventListener('click', () => setToolbar(!prefs.toolbar));
  const bar = $('format');
  for (const btn of bar.querySelectorAll('[data-fmt]')) {
    const key = btn.dataset.key;
    const name = btn.getAttribute('aria-label');
    btn.title = key ? `${name} (${MOD}${key === 'Z' ? 'Z' : key})` : name;
    // Keep the page's selection: a click on a button doesn't take the focus.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      const f = btn.dataset.fmt;
      if (f === 'link') openLinkField();
      else if (f === 'undo' || f === 'redo') undoFormat(f === 'redo');
      else format(f);
    });
  }
  const select = $('fmt-block');
  select.addEventListener('change', () => {
    format(select.value);
    focusDoc();
  });
  $('fmt-link').addEventListener('submit', (e) => {
    e.preventDefault();
    applyLinkField(false);
  });
  $('fmt-unlink').addEventListener('click', () => applyLinkField(true));
  $('fmt-link-cancel').addEventListener('click', () => closeLinkField());
  $('fmt-url').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeLinkField();
    }
  });

  // Ctrl/Cmd+B, I, K, and in Read mode Z / Shift+Z / Y, while the toolbar is shown.
  document.addEventListener('keydown', (e) => {
    if (!prefs.toolbar || !(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
    const d = current();
    if (!d) return;
    const target = e.composedPath()[0];
    const inEditor = d.editing && target === d.editor;
    const inPage = !d.editing && !isTyping(target);
    if (!inEditor && !inPage) return;
    const k = (e.key || '').toLowerCase();
    const action = { b: 'strong', i: 'em', k: 'link' }[k];
    if (action && !e.shiftKey) {
      e.preventDefault();
      if (action === 'link') openLinkField();
      else format(action);
    } else if (inPage && (k === 'z' || k === 'y')) {
      e.preventDefault();
      undoFormat(k === 'y' || e.shiftKey);
    }
  });
}

/* ---------- opening files ---------- */

async function findOpen(entry, file) {
  for (const d of docs) {
    if (d.kind !== 'file') continue;
    if (entry.handle && d.handle) {
      try {
        if (await d.handle.isSameEntry(entry.handle)) return d;
      } catch (err) { /* compare by details below */ }
      continue;
    }
    if (d.path === entry.path && d.size === file.size && d.mtime === file.lastModified) {
      if (entry.handle && !d.handle) d.handle = entry.handle;
      return d;
    }
  }
  return null;
}

// entries: [{ path, file } | { path, handle }]. explicit = the user picked these
// files themselves (so open them whatever their extension); otherwise they came
// from walking a folder and only Markdown and images are taken.
async function intake(entries, { explicit = true, from = '' } = {}) {
  if (!explicit) entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const fresh = [];
  const skipped = [];
  let focus = null;
  let images = 0;
  let truncated = false;
  for (const entry of entries) {
    const name = baseName(entry.path);
    const ext = extOf(name);
    let file;
    try {
      file = entry.file || await entry.handle.getFile();
    } catch (err) {
      skipped.push(name);
      continue;
    }
    if (IMG_EXT.has(ext) || (file.type || '').startsWith('image/')) {
      assets.set(entry.path, { file });
      images++;
      continue;
    }
    if (!explicit && !MD_EXT.has(ext)) continue;
    if (file.size > MAX_BYTES) {
      skipped.push(name + ' (over 20 MB)');
      continue;
    }
    if (explicit && entry.handle) recent.add(entry.handle);
    const open = await findOpen(entry, file);
    if (open) {
      await refreshDoc(open, file);
      focus = focus || open;
      continue;
    }
    if (!explicit && fresh.length >= MAX_FOLDER_DOCS) {
      truncated = true;
      continue;
    }
    const r = await readText(file);
    if (r.binary) {
      skipped.push(name + ' (not text)');
      continue;
    }
    fresh.push(makeDoc({
      name, path: entry.path, text: r.text, banner: r.banner, encoding: r.encoding, bom: r.bom,
      handle: entry.handle || null, mtime: file.lastModified, size: file.size,
    }));
  }

  if (images) for (const d of docs) if (d.kind !== 'sample') d.article = null; // their images may resolve now
  if (fresh.length) {
    docs = docs.filter((d) => d.kind !== 'sample' || d.dirty); // the samples make way for real files (unless edited)
    docs.push(...fresh);
  }
  const target = focus || fresh[0];
  if (target) activateDoc(target.id);
  else if (images && current() && !current().editing) showDoc(current());

  const parts = [];
  if (fresh.length > 1 || from) parts.push(`Opened ${fresh.length} Markdown file${fresh.length === 1 ? '' : 's'}${from ? ' from ' + from : ''}`);
  if (images && (fresh.length !== 1 || from)) parts.push(`${fresh.length ? 'found' : 'added'} ${images} image${images === 1 ? '' : 's'} for them`);
  if (truncated) parts.push(`stopped at ${MAX_FOLDER_DOCS} files`);
  if (skipped.length) parts.push('skipped ' + skipped.slice(0, 3).join(', ') + (skipped.length > 3 ? ` and ${skipped.length - 3} more` : ''));
  if (!fresh.length && !focus && !images && !skipped.length) parts.push(from ? `No Markdown files in ${from}` : 'Nothing to open');
  if (parts.length) toast(parts.join('; ') + '.');
}

function openText(text) {
  const d = makeDoc({ name: `pasted-${++pasteCount}.md`, kind: 'paste', text });
  docs = docs.filter((x) => x.kind !== 'sample' || x.dirty);
  docs.push(d);
  activateDoc(d.id);
}

function openSample(name, opts = {}) {
  const key = Object.keys(DATA.samples).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return null;
  let d = docs.find((x) => x.kind === 'sample' && x.path === key);
  if (!d) {
    d = makeDoc({ name: key, path: key, kind: 'sample', text: DATA.samples[key] });
    docs.push(d);
  }
  if (opts.activate !== false) activateDoc(d.id, opts);
  return d;
}

const wanted = (name) => MD_EXT.has(extOf(name)) || IMG_EXT.has(extOf(name));
const skipDir = (name) => name.startsWith('.') || SKIP_DIRS.has(name);

async function walkHandle(dir, prefix, out, depth = 0) {
  if (depth > 8) return;
  for await (const [name, h] of dir.entries()) {
    if (out.length >= MAX_FOLDER_ENTRIES) return;
    if (h.kind === 'directory') {
      if (!skipDir(name)) await walkHandle(h, prefix + name + '/', out, depth + 1);
    } else if (wanted(name)) {
      out.push({ path: prefix + name, handle: h });
    }
  }
}

function walkEntry(dirEntry, prefix, out, depth = 0) { // drag-and-drop folders without the handle API
  return new Promise((resolve) => {
    if (depth > 8) { resolve(); return; }
    const reader = dirEntry.createReader();
    const pending = [];
    const read = () => reader.readEntries((batch) => {
      if (!batch.length || out.length >= MAX_FOLDER_ENTRIES) {
        Promise.all(pending).then(() => resolve());
        return;
      }
      for (const e of batch) {
        if (e.isDirectory) {
          if (!skipDir(e.name)) pending.push(walkEntry(e, prefix + e.name + '/', out, depth + 1));
        } else if (wanted(e.name)) {
          pending.push(new Promise((done) => e.file((file) => { out.push({ path: prefix + e.name, file }); done(); }, () => done())));
        }
      }
      read();
    }, () => resolve());
    read();
  });
}

async function pickFiles() {
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn'] } }],
      });
      await intake(handles.map((h) => ({ path: h.name, handle: h })));
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      // not allowed in this frame: use the plain file input instead
    }
  }
  $('file-input').click();
}

async function openFolder(dir) {
  recent.add(dir);
  const out = [];
  await walkHandle(dir, dir.name + '/', out);
  await intake(out, { explicit: false, from: dir.name });
}

async function pickFolder() {
  if (window.showDirectoryPicker) {
    try {
      await openFolder(await window.showDirectoryPicker({ mode: 'read' }));
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  $('dir-input').click();
}

async function onDrop(e) {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging');
  const dt = e.dataTransfer;
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file');
  if (!items.length) {
    const text = dt.getData('text/plain');
    if (text && text.trim()) openText(text);
    return;
  }
  // Everything has to be requested from the items before the first await.
  const grabbed = items.map((i) => ({
    file: i.getAsFile(),
    entry: i.webkitGetAsEntry ? i.webkitGetAsEntry() : null,
    handle: i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null,
  }));
  const picked = [];
  const walked = [];
  let folder = '';
  for (const g of grabbed) {
    const handle = g.handle ? await g.handle : null;
    if (handle && handle.kind === 'directory') {
      folder = folder || handle.name;
      recent.add(handle);
      await walkHandle(handle, handle.name + '/', walked);
    } else if (handle) {
      picked.push({ path: handle.name, handle });
    } else if (g.entry && g.entry.isDirectory) {
      folder = folder || g.entry.name;
      await walkEntry(g.entry, g.entry.name + '/', walked);
    } else if (g.file) {
      picked.push({ path: g.file.name, file: g.file });
    }
  }
  if (walked.length || folder) await intake(walked, { explicit: false, from: folder });
  if (picked.length) await intake(picked);
}

/* ---------- recently opened (Chromium: file and folder handles kept in IndexedDB) ---------- */

const recent = (() => {
  // Only browsers with the file pickers hand out handles that survive a reload.
  const supported = !!(window.showOpenFilePicker && window.indexedDB);
  const MAX = 12;
  let items = []; // newest first: { key, name, handle, when }
  let dbPromise = null;
  let chain = Promise.resolve(); // adds run one at a time, so duplicates are caught

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('md-whatever-reader', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('recent', { keyPath: 'key' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function store(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('recent', mode);
      const req = fn(t.objectStore('recent'));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }

  async function load() {
    if (!supported) return;
    try {
      items = ((await store('readonly', (s) => s.getAll())) || []).sort((a, b) => b.when - a.when);
    } catch (err) {
      items = []; // storage blocked: the list just stays empty
    }
    render();
  }

  async function addNow(handle) {
    let same = null;
    for (const it of items) {
      try {
        if (await it.handle.isSameEntry(handle)) { same = it; break; }
      } catch (err) { /* moved or gone: not the same */ }
    }
    const item = { key: same ? same.key : `${Date.now()}-${Math.random()}`, name: handle.name, handle, when: Date.now() };
    items = [item, ...items.filter((it) => it !== same)];
    const dropped = items.slice(MAX);
    items = items.slice(0, MAX);
    render();
    await store('readwrite', (s) => {
      s.put(item);
      for (const it of dropped) s.delete(it.key);
    });
  }

  function add(handle) {
    if (supported && handle) chain = chain.then(() => addNow(handle)).catch(() => {});
  }

  function remove(item) {
    items = items.filter((it) => it !== item);
    render();
    store('readwrite', (s) => s.delete(item.key)).catch(() => {});
  }

  function clear() {
    items = [];
    render();
    store('readwrite', (s) => s.clear()).catch(() => {});
  }

  async function reopen(item) {
    const { handle } = item;
    try {
      // Read access lapses when the page closes; asking again is one click.
      let state = await handle.queryPermission({ mode: 'read' });
      if (state !== 'granted') state = await handle.requestPermission({ mode: 'read' });
      if (state !== 'granted') return;
      if (handle.kind === 'directory') {
        await openFolder(handle);
      } else {
        await handle.getFile(); // throws if it was moved or deleted
        await intake([{ path: handle.name, handle }]);
      }
      if (narrow.matches) setRail(false);
    } catch (err) {
      if (err && err.name === 'NotFoundError') {
        remove(item);
        toast(`${item.name} was moved or deleted, so it is no longer in Recent.`);
      } else {
        toast(`Could not open ${item.name}: ${(err && err.message) || err}`);
      }
    }
  }

  function render() {
    $('recent').hidden = !items.length;
    $('recent-list').replaceChildren(...items.map((item) => {
      const li = el('li', 'file');
      const main = el('button', 'file-main');
      main.type = 'button';
      main.title = item.handle.kind === 'directory' ? `Open the folder ${item.name} again` : `Open ${item.name} again`;
      main.append(el('span', 'file-name', item.name), el('span', 'file-meta', item.handle.kind === 'directory' ? 'Folder' : 'File'));
      main.addEventListener('click', () => reopen(item));
      li.append(main);
      return li;
    }));
  }

  return { load, add, clear };
})();

/* ---------- sharing (hosted version): links to an encrypted copy, md.wtvr.sh/are/<id>#<key> ---------- */

// The file is encrypted here (lib.js packShare) and only the encrypted bytes go
// to the server (share/worker.js); the key is in the link's #part, which never
// leaves the browser. A link is a snapshot of the document as it was then.
// Each document remembers its link (d.share) and, for Stop sharing after a
// reload, so does this browser: localStorage, by document, with the delete token.

const SHARE_MAX = 1024 * 1024; // the server's limit for the encrypted file
const SHARES_KEY = 'mdw-shares';
const hosted = /^https?:$/.test(location.protocol) && !!document.querySelector('link[rel="manifest"]');
let sharePanelFor = null; // the document the panel is open for

const shareKeyOf = (d) => `${d.kind}:${d.path || d.name}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

async function digestOf(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadShares() {
  try {
    const all = JSON.parse(localStorage.getItem(SHARES_KEY) || '[]');
    return Array.isArray(all) ? all.filter((s) => s && Date.parse(s.expires) > Date.now()) : [];
  } catch (err) {
    return [];
  }
}

function storeShares(list) {
  try { localStorage.setItem(SHARES_KEY, JSON.stringify(list)); } catch (err) { /* private window: this session only */ }
}

function rememberShare(d) {
  const list = loadShares().filter((s) => s.id !== d.share.id);
  list.push({ ...d.share, doc: shareKeyOf(d) });
  storeShares(list.slice(-200));
}

function forgetShare(id) {
  storeShares(loadShares().filter((s) => s.id !== id));
}

// The link this document was last shared with, if it's still live.
function shareOf(d) {
  if (d.share && Date.parse(d.share.expires) <= Date.now()) d.share = null;
  if (!d.share) {
    const mine = loadShares().filter((s) => s.doc === shareKeyOf(d));
    if (mine.length) {
      const { doc, ...share } = mine[mine.length - 1];
      d.share = share;
    }
  }
  return d.share;
}

function shareNote(text, isError = false) {
  const note = $('share-note');
  note.textContent = text;
  note.classList.toggle('is-error', isError);
}

const PRIVACY = 'Encrypted in your browser: only people with the link can read it. Not even md.wtvr.sh can.';

async function renderSharePanel() {
  const d = current();
  const panel = $('share-panel');
  if (!d || !sharePanelFor || sharePanelFor !== d.id) {
    panel.hidden = true;
    sharePanelFor = null;
    $('share').setAttribute('aria-expanded', 'false');
    return;
  }
  panel.hidden = false;
  $('share').setAttribute('aria-expanded', 'true');
  $('share-name').textContent = d.name;
  const share = shareOf(d);
  $('share-made').hidden = !share;
  $('share-create').textContent = share ? 'Create a new link' : 'Create link';
  $('share-lead').textContent = share ? 'Or make a new link, with what it says now, that expires after' : 'Share ';
  $('share-name').hidden = !!share;
  $('share-tail').textContent = share ? '' : ' as a link that expires after';
  if (!share) {
    shareNote(PRIVACY);
    return;
  }
  $('share-link').value = share.link;
  $('share-expires').textContent = 'Expires ' + shortDate(share.expires);
  if (d.editor) syncDraft(d);
  const same = (await digestOf(sourceOf(d))) === share.digest;
  if (sharePanelFor !== d.id || d.share !== share) return; // changed while hashing
  shareNote(same ? PRIVACY : `You've changed ${d.name} since this link was made. It still shows the earlier version.`);
}

function openSharePanel(on = sharePanelFor == null) {
  const d = current();
  sharePanelFor = on && d ? d.id : null;
  renderSharePanel();
  if (sharePanelFor) {
    const share = d.share;
    if (share) $('share-link').select();
    ($(share ? 'share-copy' : 'share-create')).focus();
  }
}

async function copyShareLink(quiet = false) {
  const input = $('share-link');
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Link copied');
  } catch (err) {
    input.select(); // the browser said no: leave it selected for Ctrl/Cmd+C
    if (!quiet) toast(`Copy the selected link with ${MOD}C`);
  }
}

// The message for a failed request: the server's own when it sent one.
async function serverMessage(res, fallback) {
  try {
    const body = await res.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch (err) { /* not JSON */ }
  return `${fallback} (${res.status})`;
}

const OFFLINE = `Couldn't reach ${location.host}. Check your connection and try again.`;

async function createShare() {
  const d = current();
  if (!d || sharePanelFor !== d.id) return;
  if (d.editor) syncDraft(d);
  const text = sourceOf(d);
  const days = Number($('share-days').value);
  const button = $('share-create');
  button.disabled = true;
  shareNote('Encrypting and uploading…');
  try {
    const { bytes, key } = await packShare({ name: d.name, text });
    if (bytes.length > SHARE_MAX) {
      shareNote(`${d.name} is too big to share: shared files can be up to 1 MB compressed.`, true);
      return;
    }
    let res;
    try {
      res = await fetch(`/api/shares?days=${days}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream' } });
    } catch (err) {
      shareNote(OFFLINE, true);
      return;
    }
    if (!res.ok) {
      shareNote(await serverMessage(res, 'The link could not be made'), true);
      return;
    }
    const { id, token, expires } = await res.json();
    d.share = { id, token, expires, link: shareLink(location.origin, id, key), digest: await digestOf(text) };
    rememberShare(d);
    await renderSharePanel();
    $('share-link').select();
    $('share-copy').focus();
    copyShareLink(true);
  } finally {
    button.disabled = false;
  }
}

async function stopSharing() {
  const d = current();
  const share = d && shareOf(d);
  if (!share) return;
  const button = $('share-stop');
  button.disabled = true;
  try {
    let res;
    try {
      res = await fetch(`/api/shares/${share.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + share.token } });
    } catch (err) {
      shareNote(OFFLINE, true);
      return;
    }
    if (!res.ok && res.status !== 404) {
      shareNote(await serverMessage(res, 'The link could not be removed'), true);
      return;
    }
    forgetShare(share.id);
    if (d.share === share) d.share = null;
    renderSharePanel();
    toast('Stopped sharing. The link no longer works.');
  } finally {
    button.disabled = false;
  }
}

function bindShare() {
  $('share').addEventListener('click', () => openSharePanel());
  $('share-close').addEventListener('click', () => openSharePanel(false));
  $('share-create').addEventListener('click', createShare);
  $('share-copy').addEventListener('click', () => copyShareLink());
  $('share-stop').addEventListener('click', stopSharing);
  $('share-link').addEventListener('focus', (e) => e.target.select());
  $('share-panel').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    openSharePanel(false);
    $('share').focus();
  });
}

// The empty state's own words, put back once a document shows.
let emptyDefault = null;
function emptyMessage(title, text) {
  if (!emptyDefault) emptyDefault = [$('empty-title').textContent, $('empty-text').textContent];
  $('empty-title').textContent = title;
  $('empty-text').textContent = text;
}
function restoreEmptyMessage() {
  if (emptyDefault) emptyMessage(...emptyDefault);
}

// Opening md.wtvr.sh/are/<id>#<key>: fetch, decrypt, show. False (with the
// reason in the empty state) when it can't.
async function openShared({ id, key }) {
  const problem = (title, text) => {
    activateDoc(null);
    emptyMessage(title, text);
    return false;
  };
  if (!id || !key) {
    return problem('This link is incomplete', 'Part of it is missing, often the end, after the #. Ask for it again, or copy the whole link.');
  }
  let res;
  try {
    res = await fetch(`/api/shares/${id}`, { cache: 'no-store' });
  } catch (err) {
    return problem(`Couldn't reach ${location.host}`, 'The shared file is stored there. Check your connection and reload the page.');
  }
  if (res.status === 404 || res.status === 410) {
    return problem('This link has expired or was removed', 'Ask whoever sent it for a new one.');
  }
  if (!res.ok) return problem('The shared file could not be loaded', (await serverMessage(res, 'Server error')) + ' Try again later.');
  let file;
  try {
    file = await unpackShare(new Uint8Array(await res.arrayBuffer()), key);
  } catch (err) {
    return problem(err.code === 'version' ? 'Shared from a newer md-whatever' : 'This link is damaged', err.message);
  }
  const d = makeDoc({ name: file.name, kind: 'shared', text: file.text, expires: res.headers.get('Mdw-Expires') || '' });
  docs.push(d);
  activateDoc(d.id);
  return true;
}

/* ---------- the installed app: files opened from Finder or Explorer, offline, updates ---------- */

// Chromium-based browsers, app installed: "Open With" md-whatever, or a
// double-click once it's the default, hands the files over here (manifest
// file_handlers). With launch_handler focus-existing, an open window gets them.
function acceptLaunches() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer((params) => {
    const handles = (params.files || []).filter((h) => h.kind === 'file');
    if (handles.length) intake(handles.map((h) => ({ path: h.name, handle: h })));
  });
}

// Only the hosted site (it links a manifest) has a service worker to register.
function serviceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)
      || !document.querySelector('link[rel="manifest"]')) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => { // from the root: share links are /are/<id>
    // A new version waits until every window is closed; offer to switch now.
    const offer = () => {
      if (reg.waiting && navigator.serviceWorker.controller) $('update').hidden = false;
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (incoming) incoming.addEventListener('statechange', () => { if (incoming.state === 'installed') offer(); });
    });
    $('update-reload').addEventListener('click', () => {
      reloading = true;
      if (reg.waiting) reg.waiting.postMessage('skip-waiting');
      else location.reload();
    });
    // An app window can stay open for days; look for a new version now and then.
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - checked < 3600e3) return;
      checked = Date.now();
      reg.update().catch(() => {});
    });
  }).catch(() => { /* no offline copy then; the page works the same */ });
  $('update-dismiss').addEventListener('click', () => { $('update').hidden = true; });
}

/* ---------- links inside a document ---------- */

function followLocal(d, rel, frag) {
  const target = resolvePath(dirName(d.path), rel);
  if (target === d.path) {
    if (frag) scrollToAnchor(d, frag);
    return;
  }
  const name = baseName(target);
  if (!MD_EXT.has(extOf(target))) {
    toast(`${name} is not a Markdown file, so it cannot be shown here.`);
    return;
  }
  const sample = d.kind === 'sample';
  const pool = docs.filter((x) => (x.kind === 'sample') === sample);
  let hit = pool.find((x) => x.path === target) || pool.find((x) => x.path.toLowerCase() === target.toLowerCase());
  if (!hit) {
    const same = pool.filter((x) => x.name.toLowerCase() === name.toLowerCase());
    if (same.length === 1) hit = same[0];
  }
  if (!hit && sample) hit = openSample(name, { activate: false });
  if (hit) activateDoc(hit.id, { anchor: frag });
  else toast(`${name} is not open. Open it, or open the folder it is in, to follow this link.`);
}

root.addEventListener('click', (e) => {
  const a = e.target.closest ? e.target.closest('a[href]') : null;
  if (a && prefs.toolbar && !(e.ctrlKey || e.metaKey)) {
    e.preventDefault(); // formatting: a click puts the cursor in the link text; Ctrl/Cmd+click follows it
    return;
  }
  if (!a || a.target === '_blank') return; // web and mail links open in a new tab
  e.preventDefault();
  const d = current();
  if (!d) return;
  const { path, frag } = splitHref(a.getAttribute('href'));
  if (path) followLocal(d, path, frag);
  else if (frag) scrollToAnchor(d, frag);
  else host.scrollTop = 0;
});
root.addEventListener('auxclick', (e) => {
  const a = e.target.closest ? e.target.closest('a[href]') : null;
  if (a && a.target !== '_blank') e.preventDefault(); // a relative link has nowhere to go in a new tab
});

/* ---------- controls ---------- */

function isTyping(target) {
  return !!(target && target.closest && target.closest('input, select, textarea, [contenteditable=""], [contenteditable="true"]'));
}

let dragDepth = 0;
function bind() {
  bindToolbar();
  bindShare();
  const select = $('theme-select');
  for (const name of Object.keys(DATA.themes)) {
    if (name !== 'base') select.append(new Option(name, name));
  }
  select.addEventListener('change', () => { prefs.theme = select.value; savePrefs(); applyTheme(); });
  for (const b of document.querySelectorAll('[data-appearance-choice]')) {
    b.addEventListener('click', () => { prefs.appearance = b.dataset.appearanceChoice; savePrefs(); applyTheme(); });
  }
  systemDark.addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  $('web-images').addEventListener('change', (e) => {
    prefs.webImages = e.target.checked;
    savePrefs();
    for (const d of docs) d.article = null;
    const d = current();
    if (d && !d.editing) {
      const keep = host.scrollTop;
      showDoc(d);
      host.scrollTop = keep;
    }
  });

  for (const id of ['open-files', 'empty-open-files']) $(id).addEventListener('click', pickFiles);
  $('mode').addEventListener('click', () => { const d = current(); if (d) setEditing(d, !d.editing); });
  $('save').addEventListener('click', () => save(current()));
  $('conflict-reload').addEventListener('click', () => { const d = current(); if (d) reloadFromDisk(d); });
  $('conflict-keep').addEventListener('click', () => {
    const d = current();
    if (d) d.conflict = 'kept'; // saving will still ask before replacing the file
    renderBar();
  });
  // Closing the tab or app with unsaved changes: the browser asks first.
  window.addEventListener('beforeunload', (e) => {
    for (const d of docs) if (d.editor) syncDraft(d);
    if (!docs.some((d) => d.dirty)) return;
    e.preventDefault();
    e.returnValue = '';
  });
  $('recent-clear').addEventListener('click', () => recent.clear());
  for (const id of ['open-folder', 'empty-open-folder']) $(id).addEventListener('click', pickFolder);
  for (const id of ['show-welcome', 'empty-welcome']) $(id).addEventListener('click', () => {
    openSample('welcome.md');
    if (narrow.matches) setRail(false);
  });
  $('file-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) intake(files.map((file) => ({ path: file.name, file })));
  });
  $('dir-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const out = files
      .filter((f) => wanted(f.name) && !(f.webkitRelativePath || '').split('/').slice(1, -1).some(skipDir))
      .map((file) => ({ path: file.webkitRelativePath || file.name, file }));
    intake(out, { explicit: false, from: (files[0].webkitRelativePath || '').split('/')[0] || 'that folder' });
  });

  $('rail-toggle').addEventListener('click', () => setRail(!app.classList.contains('rail-open')));
  $('scrim').addEventListener('click', () => setRail(false));
  $('zoom-in').addEventListener('click', () => setZoom(prefs.zoom + 0.1));
  $('zoom-out').addEventListener('click', () => setZoom(prefs.zoom - 0.1));

  // sidebar width
  const grip = $('rail-grip');
  const setWidth = (w) => {
    prefs.railWidth = Math.min(520, Math.max(190, Math.round(w)));
    document.documentElement.style.setProperty('--rail-w', prefs.railWidth + 'px');
  };
  setWidth(prefs.railWidth);
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('is-dragging');
    const left = $('rail').getBoundingClientRect().left;
    const move = (ev) => setWidth(ev.clientX - left);
    const up = () => {
      grip.classList.remove('is-dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      savePrefs();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setWidth(prefs.railWidth + (e.key === 'ArrowRight' ? 16 : -16));
    savePrefs();
  });

  // drag and drop anywhere
  // Text dragged onto the editor goes into it, as in any text field.
  const carriesContent = (e) => {
    const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
    return types.includes('Files') || (types.includes('text/plain') && !isTyping(e.composedPath()[0]));
  };
  window.addEventListener('dragenter', (e) => {
    if (!carriesContent(e)) return;
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!carriesContent(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dragging');
  });
  window.addEventListener('drop', (e) => {
    if (!carriesContent(e)) return;
    onDrop(e).catch((err) => toast('Could not open what was dropped: ' + ((err && err.message) || err)));
  });

  // paste Markdown text (the app's `md-whatever -`)
  document.addEventListener('paste', (e) => {
    if (isTyping(e.composedPath()[0]) || !e.clipboardData) return;
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      intake(files.map((file) => ({ path: file.name, file })));
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (!text || !text.trim()) return;
    e.preventDefault();
    openText(text);
  });

  // Cmd/Ctrl+S saves (instead of the browser's "Save Page As"), Shift as well: save as.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key || '').toLowerCase() !== 's') return;
    e.preventDefault();
    if (current()) save(current(), { as: e.shiftKey });
  });

  // keys, after the app's own
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.composedPath()[0])) return;
    const line = 48;
    const d = current();
    const scroller = d && d.editing ? d.editor : host;
    switch (e.key) {
      case 'j': scroller.scrollBy(0, line); break;
      case 'k': scroller.scrollBy(0, -line); break;
      case 'g': scroller.scrollTop = 0; break;
      case 'G': scroller.scrollTop = scroller.scrollHeight; break;
      case 'e': setEditing(d, true); break;
      case 't': setToolbar(!prefs.toolbar); break;
      case '[': step(-1); break;
      case ']': step(1); break;
      case '+': case '=': setZoom(prefs.zoom + 0.1); break;
      case '-': setZoom(prefs.zoom - 0.1); break;
      case '0': setZoom(1); break;
      case 'r': reloadCurrent(); break;
      case 'o': pickFiles(); break;
      case 'Escape': if (narrow.matches) setRail(false); return;
      default: return;
    }
    e.preventDefault();
  });
}

/* ---------- start ---------- */

async function start() {
  bind();
  applyTheme();
  setRail(!narrow.matches);
  try {
    await engine.init();
  } catch (err) {
    activateDoc(null);
    $('empty-title').textContent = 'The Markdown engine could not start';
    $('empty-text').textContent = 'This browser blocked both the WebAssembly build and its JavaScript fallback: ' + ((err && err.message) || err);
    return;
  }
  host.dataset.engine = engine.kind;
  const link = hosted && parseShareLink(location.href);
  if (link) await openShared(link); // a share link shows that file (or why it can't) instead of the welcome page
  else openSample('welcome.md');
  if (hosted && new URLSearchParams(location.search).has('moved')) {
    // sent here from the old address, pywkt.github.io/md-whatever (web/moved/)
    history.replaceState(null, '', location.pathname + location.hash);
    toast(`md-whatever moved to ${location.host}. Recent files and settings start fresh here; you can install it again from this address.`, 12000);
  }
  acceptLaunches(); // files from a launch replace the welcome page, as any opened file does
  recent.load();
  serviceWorker();
}

start();
})();
