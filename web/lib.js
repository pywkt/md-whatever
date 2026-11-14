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

return {
  mix, paletteCss, scopeSelector, scopeCss,
  baseName, dirName, extOf, resolvePath, safeDecode, splitHref, hasScheme,
  titleOf,
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = mdwLib;
