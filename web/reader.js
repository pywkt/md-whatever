(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const DATA = JSON.parse($('mdw-data').textContent);
const {
  paletteCss, scopeCss, baseName, dirName, extOf, resolvePath, splitHref, hasScheme, titleOf,
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

const prefs = { theme: 'default', appearance: 'system', zoom: 1, railWidth: 268, webImages: false };
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
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
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

function makeDoc(fields) {
  return Object.assign({
    id: ++seq, name: '', path: '', kind: 'file', text: '', banner: '',
    handle: null, mtime: 0, size: 0, article: null, scroll: 0,
  }, fields);
}

function metaOf(d) {
  if (d.kind === 'sample') return 'Sample';
  if (d.kind === 'paste') return 'Pasted text';
  if (!('title' in d)) d.title = titleOf(d.text);
  return [dirName(d.path), d.title].filter(Boolean).join(' · ');
}

async function readText(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8000));
  if (head.includes(0)) return { binary: true };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), banner: '' };
  } catch (err) {
    return { text: new TextDecoder('iso-8859-1').decode(buf), banner: NOT_UTF8 };
  }
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
    node.replaceWith(result.cloneNode(true));
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

function buildArticle(d) {
  const article = el('article', 'markdown-body');
  let html;
  try {
    html = engine.render(d.text);
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
  if (d.banner) article.append(el('div', 'banner', d.banner));
  article.append(tpl.content);
  if (!d.text.trim()) article.append(el('p', 'mdw-note', 'This file is empty.'));
  highlightIn(article);
  typesetIn(article);
  return article;
}

/* ---------- showing documents ---------- */

function showArticle(d) {
  if (!d.article) d.article = buildArticle(d);
  page.replaceChildren(d.article);
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
  if (prev && prev.article && prev.article.isConnected) prev.scroll = host.scrollTop;
  activeId = id;
  const d = current();
  renderRail();
  renderBar();
  if (!d) {
    page.replaceChildren();
    host.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  host.hidden = false;
  emptyEl.hidden = true;
  showArticle(d);
  host.scrollTop = d.scroll;
  if (opts.anchor) scrollToAnchor(d, opts.anchor);
  if (d.handle) checkFresh(d);
}

function closeDoc(id) {
  const i = docs.findIndex((d) => d.id === id);
  if (i < 0) return;
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
    main.append(el('span', 'file-name', d.name));
    const meta = metaOf(d);
    if (meta) main.append(el('span', 'file-meta', meta));
    if (d.id === activeId) {
      main.setAttribute('aria-current', 'page');
      activeButton = main;
    }
    main.addEventListener('click', (e) => {
      activateDoc(d.id);
      if (narrow.matches) setRail(false);
      if (e.detail) host.focus({ preventScroll: true }); // mouse: keys now scroll the document
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

function renderBar() {
  const d = current();
  $('bar-name').textContent = d ? d.name : 'No file open';
  $('bar-path').textContent = d ? dirName(d.path) : '';
  $('live').hidden = !(d && d.handle);
  document.title = (d ? d.name + ' · ' : '') + 'md-whatever Reader';
}

function setRail(open) {
  app.classList.toggle('rail-open', open);
  $('rail-toggle').setAttribute('aria-expanded', String(open));
}

/* ---------- live reload ---------- */

async function refreshDoc(d, file) {
  if (!file) file = await d.handle.getFile();
  const r = await readText(file);
  d.mtime = file.lastModified;
  d.size = file.size;
  if (r.binary || (r.text === d.text && r.banner === d.banner)) return false;
  d.text = r.text;
  d.banner = r.banner;
  d.article = null;
  delete d.title;
  if (d.id === activeId) {
    const keep = host.scrollTop; // keep your place, as the app does
    showArticle(d);
    host.scrollTop = keep;
  }
  renderRail();
  return true;
}

async function checkFresh(d) {
  if (!d.handle || d.checking) return false;
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

async function reloadCurrent() {
  const d = current();
  if (!d) return;
  if (!d.handle) {
    toast(d.kind === 'file' ? 'This browser cannot re-read the file. Open it again to refresh it.' : 'Nothing to reload for ' + d.name + '.');
    return;
  }
  toast((await checkFresh(d)) ? 'Reloaded ' + d.name : d.name + ' is up to date');
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
      name, path: entry.path, text: r.text, banner: r.banner,
      handle: entry.handle || null, mtime: file.lastModified, size: file.size,
    }));
  }

  if (images) for (const d of docs) if (d.kind !== 'sample') d.article = null; // their images may resolve now
  if (fresh.length) {
    docs = docs.filter((d) => d.kind !== 'sample'); // the samples make way for real files
    docs.push(...fresh);
  }
  const target = focus || fresh[0];
  if (target) activateDoc(target.id);
  else if (images && current()) showArticle(current());

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
  docs = docs.filter((x) => x.kind !== 'sample');
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
  navigator.serviceWorker.register('sw.js').then((reg) => {
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
    if (d) {
      const keep = host.scrollTop;
      showArticle(d);
      host.scrollTop = keep;
    }
  });

  for (const id of ['open-files', 'empty-open-files']) $(id).addEventListener('click', pickFiles);
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
  const carriesContent = (e) => {
    const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
    return types.includes('Files') || types.includes('text/plain');
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
    onDrop(e).catch((err) => toast('Could not open what was dropped: ' + ((err && err.message) || err)));
  });

  // paste Markdown text (the app's `md-whatever -`)
  document.addEventListener('paste', (e) => {
    if (isTyping(e.target) || !e.clipboardData) return;
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

  // keys, after the app's own
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.composedPath()[0])) return;
    const line = 48;
    switch (e.key) {
      case 'j': host.scrollBy(0, line); break;
      case 'k': host.scrollBy(0, -line); break;
      case 'g': host.scrollTop = 0; break;
      case 'G': host.scrollTop = host.scrollHeight; break;
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
  openSample('welcome.md');
  acceptLaunches(); // files from a launch replace the welcome page, as any opened file does
  recent.load();
  serviceWorker();
}

start();
})();
