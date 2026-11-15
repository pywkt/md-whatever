// md-whatever web reader: pure helpers (no DOM, no page state).
// Inlined into the page before reader.js, and loaded by the node tests in
// tests/web/. Keep everything here free of `document`, `window` and globals.
const mdwLib = (() => {
'use strict';

/* ---------- themes: a port of Theme::css() from md-whatever's theme.cpp ---------- */

function mix(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// The app fills these variables from the desktop palette. A browser has no
// desktop palette to read, so use Breeze Light / Breeze Dark, the colors the
// app itself falls back to (Theme::effectivePalette), with Plasma's blue accent.
function paletteCss(dark, zoom) {
  const bg = dark ? '#141618' : '#ffffff';
  const text = dark ? '#fcfcfc' : '#232629';
  const accent = '#3daee9';
  const vars = {
    bg,
    text,
    muted: mix(bg, text, 0.62),
    faint: mix(bg, text, 0.40),
    rule: mix(bg, text, dark ? 0.22 : 0.14),
    'code-bg': mix(bg, text, dark ? 0.07 : 0.045),
    'code-border': mix(bg, text, dark ? 0.14 : 0.09),
    'quote-bg': mix(bg, accent, dark ? 0.10 : 0.06),
    'table-head': mix(bg, text, dark ? 0.09 : 0.05),
    'table-stripe': mix(bg, text, dark ? 0.04 : 0.022),
    link: dark ? '#1d99f3' : '#2980b9',
    accent,
    'accent-text': dark ? '#fcfcfc' : '#ffffff',
    error: dark ? '#ff7b72' : '#c62828',
    'body-font': 'system-ui, -apple-system, "Segoe UI", "Noto Sans", Roboto',
    'mono-font': 'ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, "Liberation Mono"',
    'base-size': (16 * zoom).toFixed(2) + 'px',
  };
  return ':host {\n' + Object.entries(vars).map(([k, v]) => `  --${k}: ${v};\n`).join('') + '}\n';
}

// Theme files are written for a whole page (html, body, :root). Here the page
// is a shadow root, so point those three selectors at their stand-ins.
function scopeSelector(sel) {
  return sel
    .replace(/:root(?![\w-])/g, ':host')
    .replace(/(^|[\s>+~(])html((?:\.[\w-]+)*)(?![\w-])/g, (m, pre, cls) => pre + (cls ? `:host(${cls})` : ':host'))
    .replace(/(^|[\s>+~(])body(?![\w-])/g, '$1.mdw-page');
}

// A whole stylesheet: comments dropped, every selector list scoped.
function scopeCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[{}])([^{}@]+)\{/g,
    (m, lead, sel) => lead + sel.split(',').map(scopeSelector).join(',') + '{');
}

/* ---------- paths ---------- */

const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirName = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
function extOf(p) {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}
function resolvePath(fromDir, rel) {
  const parts = rel.startsWith('/') || !fromDir ? [] : fromDir.split('/');
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (err) { return s; }
}
function splitHref(href) {
  const h = href.indexOf('#');
  let path = h < 0 ? href : href.slice(0, h);
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  return { path: safeDecode(path), frag: h < 0 ? '' : safeDecode(href.slice(h + 1)) };
}
const hasScheme = (s) => /^[a-z][a-z0-9+.-]*:/i.test(s);

/* ---------- documents ---------- */

// First ATX heading, for the sidebar's second line.
function titleOf(text) {
  const m = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text.slice(0, 20000));
  return m ? m[1].replace(/[*_`]/g, '').trim() : '';
}

/* ---------- file bytes <-> text, so saving gives back the file it read ---------- */

// Browsers decode "iso-8859-1" as windows-1252, which puts 27 printable
// characters (€, curly quotes, ...) at 0x80-0x9F. Encoding needs the way back.
const CP1252 = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f'
  + '\x90‘’“”•–—˜™š›œ\x9džŸ';
const CP1252_BACK = new Map([...CP1252].map((ch, i) => [ch, 0x80 + i]));

// bytes: an ArrayBuffer or Uint8Array, as read from the file.
// Returns { binary: true } for files with NUL bytes in their first 8000 bytes,
// otherwise { text, encoding: 'utf-8' | 'latin1', bom }. The text keeps its line
// endings; a UTF-8 byte order mark is dropped from it and reported as bom.
function decodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.subarray(0, 8000).includes(0)) return { binary: true };
  const bom = u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'utf-8', bom };
  } catch (err) {
    return { text: new TextDecoder('iso-8859-1').decode(u8), encoding: 'latin1', bom: false };
  }
}

// The way back: { bytes } or, for a Latin-1 file with a character it cannot
// hold, { unencodable: thatCharacter }.
function encodeText(text, { encoding = 'utf-8', bom = false } = {}) {
  if (encoding !== 'latin1') {
    const body = new TextEncoder().encode(text);
    if (!bom) return { bytes: body };
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    return { bytes };
  }
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252_BACK.get(text[i]);
    if (b === undefined) return { unencodable: String.fromCodePoint(text.codePointAt(i)) };
    bytes[i] = b;
  }
  return { bytes };
}

// What a <textarea> does to line endings: CRLF and lone CR become LF.
const normalizeNewlines = (text) => text.replace(/\r\n?/g, '\n');

// The file's line ending: CRLF if most of its lines end that way, else LF.
function lineEnding(text) {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text[i - 1] === '\r') crlf++;
    else lf++;
  }
  return crlf > lf ? '\r\n' : '\n';
}

// Text from the editor (LF only) with the file's line ending put back.
const withLineEnding = (text, eol) => (eol === '\n' ? normalizeNewlines(text) : normalizeNewlines(text).replace(/\n/g, eol));

return {
  mix, paletteCss, scopeSelector, scopeCss,
  baseName, dirName, extOf, resolvePath, safeDecode, splitHref, hasScheme,
  titleOf,
  decodeBytes, encodeText, normalizeNewlines, lineEnding, withLineEnding,
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = mdwLib;
