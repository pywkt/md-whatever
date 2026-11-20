// md-whatever web reader: pure helpers (no DOM, no page state).
// Inlined into the page before reader.js, and loaded by the node tests in
// tests/web/. Keep everything here free of `document`, `window` and globals
// (platform APIs that node has too, like crypto and streams, are fine).
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

/* ---------- formatting toolbar: changes to the Markdown source ----------
   Every operation takes the text (LF line endings) and a selection [a, b] in
   it, and returns { text, a, b } (the new text and where the selection goes)
   or { error } (a sentence for the reader). Nothing is regenerated: each
   operation is a few insertions and deletions, so the rest of the file stays
   byte for byte as it was. */

// edits: [{ at, del, ins }], not overlapping. map(p, assoc) moves a position
// of the old text into the new one; at an insertion point assoc > 0 means
// after the inserted text, assoc < 0 before it.
function applyEdits(text, edits) {
  const sorted = edits.filter((e) => e.del || e.ins).sort((x, y) => x.at - y.at || x.del - y.del);
  let out = '';
  let pos = 0;
  for (const e of sorted) {
    out += text.slice(pos, e.at) + e.ins;
    pos = e.at + e.del;
  }
  out += text.slice(pos);
  const map = (p, assoc = -1) => {
    let delta = 0;
    for (const e of sorted) {
      const end = e.at + e.del;
      if (end < p || (end === p && e.del > 0) || (e.at === p && !e.del && assoc > 0)) {
        delta += e.ins.length - e.del;
        continue;
      }
      if (e.at < p && p < end) return e.at + delta + (assoc > 0 ? e.ins.length : 0);
      break;
    }
    return p + delta;
  };
  return { text: out, map };
}

// The part of old that changed into new: old[start, oldEnd) became new[start, newEnd).
function textDiff(before, after) {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, oldEnd, newEnd };
}

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const WORD = /[\p{L}\p{N}\p{M}'’]/u;

// The word around p (letters, digits, inner apostrophes), or [p, p].
function wordAt(text, p) {
  let a = p;
  let b = p;
  while (a > 0 && WORD.test(text[a - 1])) a--;
  while (b < text.length && WORD.test(text[b])) b++;
  while (a < b && /['’]/.test(text[a])) a++;
  while (b > a && /['’]/.test(text[b - 1])) b--;
  return a < b ? [a, b] : [p, p];
}

// After "(" of an inline link: where its destination is, and where the link ends.
function linkTail(text, i) {
  const n = text.length;
  const ws = () => { while (i < n && isSpace(text[i])) i++; };
  ws();
  let ds;
  let de;
  if (text[i] === '<') {
    const j = text.indexOf('>', i + 1);
    if (j < 0 || text.slice(i, j).includes('\n')) return null;
    ds = i;
    de = j + 1;
    i = de;
  } else {
    ds = i;
    let depth = 0;
    while (i < n && !isSpace(text[i])) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '(') depth++;
      else if (c === ')' && depth-- === 0) break;
      i++;
    }
    de = Math.min(i, n);
  }
  ws();
  const open = text[i];
  if (de > ds && (open === '"' || open === "'" || open === '(')) {
    const close = open === '(' ? ')' : open;
    let j = i + 1;
    while (j < n && text[j] !== close) j += text[j] === '\\' ? 2 : 1;
    if (j >= n) return null;
    i = j + 1;
    ws();
  }
  return text[i] === ')' ? { ds, de, end: i + 1 } : null;
}

const BARE_LINK = /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:)|^[^\s@]+@[^\s@]+$/i;

// An inline element's whole source range from the range of its content
// (cs, ce): { s, e }, plus { ds, de } (the destination) for inline links.
// null when the source around it isn't what that element would be written as.
function inlineOuter(text, kind, cs, ce) {
  const before = (n) => text.slice(Math.max(0, cs - n), cs);
  const after = (n) => text.slice(ce, ce + n);
  switch (kind) {
    case 'strong': {
      const d = before(2);
      return (d === '**' || d === '__') && after(2) === d ? { s: cs - 2, e: ce + 2 } : null;
    }
    case 'em': {
      const d = before(1);
      return (d === '*' || d === '_') && after(1) === d ? { s: cs - 1, e: ce + 1 } : null;
    }
    case 'del':
      for (const d of ['~~', '~']) if (before(d.length) === d && after(d.length) === d) return { s: cs - d.length, e: ce + d.length };
      return null;
    case 'code': {
      let s = cs;
      let e = ce;
      if (text[s - 1] === ' ' && text[e] === ' ' && text[s - 2] === '`' && text[e + 1] === '`') { s--; e++; }
      let n = 0;
      while (text[s - 1 - n] === '`') n++;
      let m = 0;
      while (text[e + m] === '`') m++;
      return n && n === m ? { s: s - n, e: e + m } : null;
    }
    case 'math':
      for (const d of ['$$', '$']) if (before(d.length) === d && after(d.length) === d) return { s: cs - d.length, e: ce + d.length };
      return null;
    case 'link': {
      if (before(1) === '<' && after(1) === '>') return { s: cs - 1, e: ce + 1, auto: true };
      if (before(1) !== '[' || after(1) !== ']') return BARE_LINK.test(text.slice(cs, ce)) ? { s: cs, e: ce, bare: true } : null;
      const next = text[ce + 1];
      if (next === '(') {
        const t = linkTail(text, ce + 2);
        return t ? { s: cs - 1, e: t.end, ds: t.ds, de: t.de } : null;
      }
      if (next === '[') {
        const j = text.indexOf(']', ce + 2);
        return j < 0 ? null : { s: cs - 1, e: j + 1, ref: true };
      }
      return { s: cs - 1, e: ce + 1, ref: true };
    }
    default:
      return null;
  }
}

const DELIM = { strong: '**', em: '*', del: '~~' };
const NOUN = { strong: 'bold', em: 'italic', del: 'strikethrough', code: 'code', link: 'a link' };

// Moves the ends of [a, b] out of elements they cut through: an end inside
// another element (or inside its markers) takes in the whole element, so
// markers never interleave. Unknown elements ({ opaque: true }) can't be cut.
function widen(a, b, els) {
  for (let changed = true; changed;) {
    changed = false;
    for (const x of els) {
      const aIn = x.s < a && a < x.e;
      const bIn = x.s < b && b < x.e;
      if (aIn === bIn) {
        if (aIn && a < x.cs && b > x.ce) { a = x.s; b = x.e; changed = true; } // markers on both sides: all of it
        continue;
      }
      if (x.opaque) return null;
      if (aIn) a = x.s;
      else b = x.e;
      changed = true;
    }
  }
  return [a, b];
}

function trimRange(text, a, b) {
  while (a < b && isSpace(text[a])) a++;
  while (b > a && isSpace(text[b - 1])) b--;
  return [a, b];
}

function codeFence(content) {
  let longest = 0;
  for (const m of content.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const fence = '`'.repeat(longest + 1);
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  return [fence + pad, pad + fence];
}

// Bold, italic, strikethrough or code on [a, b]. els: the inline elements of
// the text, { kind, s, cs, ce, e } (whole range, content range). empty: with
// nothing selected and no word at the caret, insert empty markers (the source
// editor) instead of failing (the rendered page, where they would just show).
function toggleInline(text, a, b, kind, els = [], { empty = false } = {}) {
  if (a > b) [a, b] = [b, a];
  const same = els.filter((x) => x.kind === kind && !x.opaque);
  const innermost = (list) => list.sort((x, y) => (x.e - x.s) - (y.e - y.s))[0];
  if (a === b) {
    const inside = innermost(same.filter((x) => x.cs <= a && a <= x.ce));
    if (inside) [a, b] = [inside.cs, inside.ce];
    else [a, b] = wordAt(text, a);
    if (a === b) {
      if (!empty) return { error: 'Select some text first, or put the cursor in a word.' };
      const [open, close] = kind === 'code' ? ['`', '`'] : [DELIM[kind], DELIM[kind]];
      return { text: text.slice(0, a) + open + close + text.slice(a), a: a + open.length, b: a + open.length };
    }
  }
  [a, b] = trimRange(text, a, b);
  if (a === b) return { error: 'Select some text first, or put the cursor in a word.' };
  const range = widen(a, b, els);
  if (!range) return { error: `This part of the document can't be made ${NOUN[kind]} from here. Use Edit to change its source.` };
  [a, b] = range;

  const edits = [];
  const container = innermost(same.filter((x) => x.s <= a && b <= x.e));
  if (container) {
    // Already that: take it away from the selection (or all of it).
    const x = container;
    let ca = Math.max(a, x.cs);
    let cb = Math.min(b, x.ce);
    if (kind === 'code' || (ca <= x.cs && cb >= x.ce)) {
      edits.push({ at: x.s, del: x.cs - x.s, ins: '' }, { at: x.ce, del: x.e - x.ce, ins: '' });
      const r = applyEdits(text, edits);
      return { text: r.text, a: r.map(x.cs, 1), b: r.map(x.ce, -1) };
    }
    // Split: what stays before and after keeps the formatting. Spaces at the
    // cut go to the plain middle (markers next to a space don't count).
    const [sa, sb] = [ca, cb];
    while (ca > x.cs && isSpace(text[ca - 1])) ca--;
    while (cb < x.ce && isSpace(text[cb])) cb++;
    const d = DELIM[kind];
    const left = ca > x.cs;
    const right = cb < x.ce;
    edits.push({ at: x.s, del: x.cs - x.s, ins: left ? d : '' });
    if (left) edits.push({ at: ca, del: 0, ins: d });
    if (right) edits.push({ at: cb, del: 0, ins: d });
    edits.push({ at: x.ce, del: x.e - x.ce, ins: right ? d : '' });
    const r = applyEdits(text, edits);
    return { text: r.text, a: r.map(sa, 1), b: r.map(sb, -1) };
  }

  // Add it, taking in elements of the same kind it touches.
  for (const x of same) {
    if (x.e < a || x.s > b) continue;
    a = Math.min(a, x.s);
    b = Math.max(b, x.e);
  }
  for (const x of same) {
    if (x.s < a || x.e > b) continue;
    edits.push({ at: x.s, del: x.cs - x.s, ins: '' }, { at: x.ce, del: x.e - x.ce, ins: '' });
  }
  let open = DELIM[kind];
  let close = open;
  if (kind === 'code') {
    const r0 = applyEdits(text, edits);
    [open, close] = codeFence(r0.text.slice(r0.map(a, 1), r0.map(b, -1)));
  }
  edits.push({ at: a, del: 0, ins: open }, { at: b, del: 0, ins: close });
  const r = applyEdits(text, edits);
  return { text: r.text, a: r.map(a, 1), b: r.map(b, -1) };
}

// A link destination as Markdown writes it: <...> when it has spaces or brackets.
function linkDest(url) {
  return /[\s()<>]/.test(url) ? '<' + url.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\n/g, '%0A') + '>' : url;
}

// Makes [a, b] a link to url, or changes the address of the link it is in.
function setLink(text, a, b, url, els = []) {
  url = String(url || '').trim();
  if (!url) return { error: 'Type the address for the link.' };
  const dest = linkDest(url);
  if (a > b) [a, b] = [b, a];
  const links = els.filter((x) => x.kind === 'link' && !x.opaque);
  const inLink = links.filter((x) => x.s <= a && b <= x.e).sort((x, y) => (x.e - x.s) - (y.e - y.s))[0];
  if (inLink) {
    const x = inLink;
    if (x.ds != null) { // an inline link: just its address (after the text, so the text stays put)
      const r = applyEdits(text, [{ at: x.ds, del: x.de - x.ds, ins: dest }]);
      return { text: r.text, a: x.cs, b: x.ce };
    }
    const label = text.slice(x.cs, x.ce);
    const r = applyEdits(text, [{ at: x.s, del: x.e - x.s, ins: `[${label}](${dest})` }]);
    return { text: r.text, a: x.s + 1, b: x.s + 1 + label.length };
  }
  if (a === b) [a, b] = wordAt(text, a);
  if (a === b) {
    const ins = `[${url}](${dest})`;
    return { text: text.slice(0, a) + ins + text.slice(a), a: a + 1, b: a + 1 + url.length };
  }
  [a, b] = trimRange(text, a, b);
  const range = widen(a, b, els);
  if (!range) return { error: "This part of the document can't be made a link from here. Use Edit to change its source." };
  [a, b] = range;
  const edits = [];
  for (const x of links) {
    if (x.s < a || x.e > b) continue;
    if (x.bare) continue; // a bare address inside link text is just text there
    edits.push({ at: x.s, del: x.cs - x.s, ins: '' }, { at: x.ce, del: x.e - x.ce, ins: '' });
  }
  edits.push({ at: a, del: 0, ins: '[' }, { at: b, del: 0, ins: `](${dest})` });
  const r = applyEdits(text, edits);
  return { text: r.text, a: r.map(a, 1), b: r.map(b, -1) };
}

// Takes the links in (or around) [a, b] away, keeping their text.
function removeLink(text, a, b, els = []) {
  if (a > b) [a, b] = [b, a];
  const hit = els.filter((x) => x.kind === 'link' && !x.opaque && (a === b ? x.s <= a && a <= x.e : x.s < b && a < x.e));
  if (!hit.length) return { error: 'There is no link here.' };
  if (hit.some((x) => x.bare || x.auto))
    return { error: 'Web and email addresses written out in full are always links. Change the text in Edit to unlink one.' };
  const edits = [];
  for (const x of hit) edits.push({ at: x.s, del: x.cs - x.s, ins: '' }, { at: x.ce, del: x.e - x.ce, ins: '' });
  const r = applyEdits(text, edits);
  const first = Math.min(a, ...hit.map((x) => x.s));
  const last = Math.max(b, ...hit.map((x) => x.e));
  return { text: r.text, a: r.map(first, 1), b: r.map(last, -1) };
}

/* blocks: whole source lines */

function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}
function lineIndex(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// One line, taken apart: quote markers, indentation, list marker, task box,
// heading marker, then the content. Each part is the exact source text.
function parseLine(line) {
  const quote = /^(?: {0,3}>[ \t]?)*/.exec(line)[0];
  let rest = line.slice(quote.length);
  const indent = /^[ \t]*/.exec(rest)[0];
  rest = rest.slice(indent.length);
  const out = { quote, indent, list: '', listType: null, task: '', heading: '', level: 0, content: '', blank: !rest.trim() };
  out.fence = indent.length < 4 || quote ? /^(`{3,}|~{3,})/.exec(rest) : null;
  out.hr = indent.length < 4 && /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(rest);
  if (out.fence || out.hr || out.blank) { out.content = rest; return out; }
  const lm = /^([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(rest);
  if (lm) {
    out.list = lm[0];
    out.listType = /\d/.test(lm[1]) ? 'ol' : 'ul';
    rest = rest.slice(lm[0].length);
    out.fence = /^(`{3,}|~{3,})/.exec(rest); // a list item that starts with a code block
    if (out.fence) { out.content = rest; return out; }
    const tm = /^\[[ xX]\](?:[ \t]+|$)/.exec(rest);
    if (tm) {
      out.task = tm[0];
      out.listType = 'task';
      rest = rest.slice(tm[0].length);
    }
  }
  const hm = /^(#{1,6})(?:[ \t]+|$)/.exec(rest);
  if (hm && (lm || indent.length < 4)) {
    out.heading = hm[0];
    out.level = hm[1].length;
    rest = rest.slice(hm[0].length);
  }
  out.content = rest;
  return out;
}

// What each line is: { kind: 'fm' (front matter) | 'fence' (a code block,
// fences included) | 'text', block: [first, last] line of its code block }.
function lineKinds(lines) {
  const kinds = lines.map(() => ({ kind: 'text' }));
  let i = 0;
  if (/^(?:﻿)?---[ \t]*$/.test(lines[0] || '')) {
    let j = 1;
    while (j < lines.length && !/^(?:---|\.\.\.)[ \t]*$/.test(lines[j])) j++;
    if (j < lines.length) {
      for (let k = 0; k <= j; k++) kinds[k] = { kind: 'fm' };
      i = j + 1;
    }
  }
  for (; i < lines.length; i++) {
    const p = parseLine(lines[i]);
    if (!p.fence) continue;
    const ch = p.fence[1][0];
    const len = p.fence[1].length;
    if (ch === '`' && p.content.slice(len).includes('`')) continue; // not a fence: an inline code span
    let j = i + 1;
    for (; j < lines.length; j++) {
      const q = parseLine(lines[j]);
      if (q.fence && q.fence[1][0] === ch && q.fence[1].length >= len && !q.content.slice(q.fence[1].length).trim()) break;
    }
    const last = Math.min(j, lines.length - 1);
    for (let k = i; k <= last; k++) kinds[k] = { kind: 'fence', block: [i, last] };
    i = last;
  }
  return kinds;
}

const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

// The blocks lines L1..L2 belong to, widened to whole blocks: { start, end,
// type: 'p' | 'h' | 'li' | 'code' | 'hr', first: parseLine(start), setext }.
function blockUnits(lines, kinds, L1, L2) {
  const startsBlock = (p) => !!(p.list || p.heading || p.hr || p.fence);
  const isCont = (i) => {
    if (i <= 0 || kinds[i].kind !== 'text' || kinds[i - 1].kind !== 'text') return false;
    const p = parseLine(lines[i]);
    const prev = parseLine(lines[i - 1]);
    if (p.blank || prev.blank || prev.heading || prev.hr) return false;
    return !startsBlock(p) || (SETEXT.test(lines[i]) && !prev.list && !startsBlock(prev));
  };
  if (kinds[L1].kind === 'fence') L1 = kinds[L1].block[0];
  if (kinds[L2].kind === 'fence') L2 = kinds[L2].block[1];
  while (isCont(L1)) L1--;
  while (L2 + 1 < lines.length && isCont(L2 + 1)) L2++;
  const units = [];
  let u = null;
  for (let i = L1; i <= L2; i++) {
    const k = kinds[i];
    if (k.kind === 'fm') continue;
    if (k.kind === 'fence') {
      units.push({ start: k.block[0], end: k.block[1], type: 'code', first: parseLine(lines[k.block[0]]) });
      u = null;
      i = k.block[1];
      continue;
    }
    const p = parseLine(lines[i]);
    if (p.blank) { u = null; continue; }
    if (u && u.type === 'p' && !u.setext && SETEXT.test(lines[i]) && !startsBlock(u.first)) {
      u.end = i;
      u.setext = SETEXT.exec(lines[i])[1][0] === '=' ? 1 : 2;
      u.type = 'h';
      u = null;
      continue;
    }
    if (u && !startsBlock(p) && (u.type === 'p' || u.type === 'li')) { u.end = i; continue; }
    u = { start: i, end: i, first: p, type: p.hr ? 'hr' : p.heading ? 'h' : p.list ? 'li' : 'p' };
    units.push(u);
    if (u.type === 'hr' || u.type === 'h') u = null;
  }
  return { units, L1, L2 };
}

// The block at pos, for the toolbar: { block: 'p' | 'h1'..'h6' | 'code' | 'fm',
// list: null | 'ul' | 'ol' | 'task', quote: bool }.
function blockAt(text, pos) {
  const lines = text.split('\n');
  const L = lineIndex(lineStarts(text), pos);
  const kinds = lineKinds(lines);
  if (kinds[L].kind === 'fm') return { block: 'fm', list: null, quote: false };
  const p = parseLine(lines[L]);
  if (kinds[L].kind === 'fence') return { block: 'code', list: null, quote: !!p.quote };
  const { units } = blockUnits(lines, kinds, L, L);
  const u = units.find((x) => x.start <= L && L <= x.end) || { first: p, type: 'p' };
  const level = u.setext || u.first.level;
  return { block: level ? 'h' + level : 'p', list: u.first.listType, quote: !!u.first.quote };
}

const BLOCK_KINDS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'task', 'quote', 'code', 'hr'];

// A block action on the lines [a, b] touches. kind: one of BLOCK_KINDS.
function applyBlock(text, a, b, kind) {
  if (!BLOCK_KINDS.includes(kind)) return { error: 'Unknown block type: ' + kind };
  if (a > b) [a, b] = [b, a];
  const starts = lineStarts(text);
  const lines = text.split('\n');
  const kinds = lineKinds(lines);
  const L1 = lineIndex(starts, a);
  const L2 = Math.max(L1, lineIndex(starts, b > a && starts.includes(b) ? b - 1 : b));
  for (let i = L1; i <= L2; i++) if (kinds[i].kind === 'fm') return { error: 'That is the front matter at the top of the file. Use Edit to change it.' };
  const { units, L1: from, L2: to } = blockUnits(lines, kinds, L1, L2);
  const lineEnd = (i) => starts[i] + lines[i].length;
  const prefixLen = (p) => p.quote.length + p.indent.length;
  const edits = [];
  const done = (r = applyEdits(text, edits)) => ({ text: r.text, a: r.map(a, kind === 'hr' ? 1 : -1), b: r.map(b, 1) });
  const textUnits = units.filter((u) => u.type === 'p' || u.type === 'h' || u.type === 'li');

  if (kind === 'quote') {
    const nonBlank = [];
    for (let i = from; i <= to; i++) if (lines[i].trim()) nonBlank.push(i);
    const all = nonBlank.length && nonBlank.every((i) => /^ {0,3}>/.test(lines[i]));
    for (let i = from; i <= to; i++) {
      if (all) {
        const m = /^ {0,3}> ?/.exec(lines[i]);
        if (m) edits.push({ at: starts[i], del: m[0].length, ins: '' });
      } else {
        edits.push({ at: starts[i], del: 0, ins: lines[i].trim() ? '> ' : '>' });
      }
    }
    return done();
  }

  if (kind === 'code') {
    if (units.length === 1 && units[0].type === 'code') {
      const [o, c] = [units[0].start, units[0].end];
      const closed = c > o && parseLine(lines[c]).fence;
      if (closed) edits.push({ at: lineEnd(c - 1), del: lineEnd(c) - lineEnd(c - 1), ins: '' });
      edits.push({ at: starts[o], del: (o + 1 < lines.length ? starts[o + 1] : lineEnd(o)) - starts[o], ins: '' });
      return done();
    }
    if (!units.length) return { error: 'Put the cursor in some text first.' };
    const body = lines.slice(from, to + 1).join('\n');
    let longest = 2;
    for (const m of body.matchAll(/^(?: {0,3}>[ \t]?)*[ \t]*(`{3,})/gm)) longest = Math.max(longest, m[1].length);
    const fence = parseLine(lines[from]).quote + '`'.repeat(longest + 1);
    edits.push({ at: starts[from], del: 0, ins: fence + '\n' }, { at: lineEnd(to), del: 0, ins: '\n' + fence });
    return done();
  }

  if (kind === 'hr') {
    if (!units.length && !lines[L2].trim()) {
      edits.push({ at: starts[L2], del: 0, ins: '---' + (L2 + 1 < lines.length ? '\n' : '') });
      return done();
    }
    const q = parseLine(lines[to]).quote;
    edits.push({ at: lineEnd(to), del: 0, ins: '\n' + (q ? q.trimEnd() : '') + '\n' + q + '---' });
    const r = applyEdits(text, edits);
    const after = r.map(lineEnd(to), 1);
    return { text: r.text, a: after, b: after };
  }

  if (!textUnits.length) return { error: units.length ? 'That is inside a code block. Only Quote and Code block apply there.' : 'Put the cursor in some text first.' };

  if (kind === 'p' || kind[0] === 'h') {
    let level = kind === 'p' ? 0 : Number(kind[1]);
    if (level && textUnits.every((u) => (u.setext || u.first.level) === level)) level = 0;
    for (const u of textUnits) {
      const p = u.first;
      const cur = u.setext || p.level;
      if (cur === level && !u.setext) continue;
      if (!cur && !level) continue;
      const at = starts[u.start] + prefixLen(p) + p.list.length + p.task.length;
      edits.push({ at, del: p.heading.length, ins: level ? '#'.repeat(level) + ' ' : '' });
      if (!level && p.heading) {
        const close = /[ \t]+#+[ \t]*$/.exec(lines[u.start]);
        if (close && close.index >= at - starts[u.start] + p.heading.length) edits.push({ at: starts[u.start] + close.index, del: close[0].length, ins: '' });
      }
      const last = u.setext ? u.end - 1 : u.end;
      if (level) {
        for (let i = u.start + 1; i <= last; i++) { // a heading is one line
          const q = parseLine(lines[i]);
          const lead = q.quote.length + q.indent.length;
          let trail = 0;
          while (trail < lines[i - 1].length && /[ \t\\]/.test(lines[i - 1][lines[i - 1].length - 1 - trail])) trail++;
          edits.push({ at: lineEnd(i - 1) - trail, del: trail + 1 + lead, ins: ' ' });
        }
      }
      if (u.setext) edits.push({ at: lineEnd(u.end - 1), del: lineEnd(u.end) - lineEnd(u.end - 1), ins: '' });
    }
    return done();
  }

  // lists
  const all = textUnits.every((u) => u.first.listType === kind);
  let n = 1;
  for (const u of textUnits) {
    const p = u.first;
    const at = starts[u.start] + prefixLen(p);
    if (all) {
      edits.push({ at, del: p.list.length + p.task.length, ins: '' });
      continue;
    }
    const keepTask = kind === 'task' && p.task ? p.task.replace(/[ \t]+$/, '') + ' ' : '[ ] ';
    const marker = kind === 'ul' ? '- ' : kind === 'ol' ? `${n++}. ` : '- ' + keepTask;
    edits.push({ at, del: p.list.length + p.task.length, ins: marker });
  }
  return done();
}

/* ---------- sharing: the encrypted file and its link ---------- */

// A shared file is JSON { v, name, text }, gzipped, then encrypted with AES-GCM
// under a fresh 128-bit key: bytes = 12-byte IV, then the ciphertext and tag.
// The key travels only in the link's #fragment, which browsers never send to a
// server, so md.wtvr.sh stores bytes it can't read. WebCrypto and
// CompressionStream are platform APIs: every current browser has them, and so
// does node.
//
//   https://md.wtvr.sh/are/<id>#<key>
//   id: 10 characters [0-9A-Za-z] (made by the server), key: 22 base64url

const SHARE_VERSION = 1;
const SHARE_MAX_TEXT = 20 * 1024 * 1024; // unzipped; the reader opens files up to this size

class ShareError extends Error {
  // code: 'damaged' (wrong key, cut short, not ours) or 'version' (a newer reader made it)
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toBase64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch (err) {
    return null;
  }
}

// All of a stream's bytes; past `limit`, throws instead (a zip bomb stops there).
async function readAll(stream, limit = Infinity) {
  const chunks = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      reader.cancel().catch(() => {});
      throw new RangeError('too big');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const viaStream = (bytes, transform, limit) => readAll(new Blob([bytes]).stream().pipeThrough(transform), limit);

// { name, text } -> { bytes, key }: what to upload, and the key for the link.
async function packShare({ name, text }) {
  const plain = new TextEncoder().encode(JSON.stringify({ v: SHARE_VERSION, name, text }));
  const zipped = await viaStream(plain, new CompressionStream('gzip'));
  const raw = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipped));
  const bytes = new Uint8Array(iv.length + sealed.length);
  bytes.set(iv);
  bytes.set(sealed, iv.length);
  return { bytes, key: toBase64url(raw) };
}

// The reverse; throws a ShareError when the bytes and key don't make a file.
async function unpackShare(bytes, keyText) {
  const raw = fromBase64url(keyText || '');
  if (!raw || raw.length !== 16 || bytes.length < 12 + 16) throw new ShareError('damaged', 'The link or the shared file is damaged.');
  let plain;
  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const zipped = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    plain = await viaStream(new Uint8Array(zipped), new DecompressionStream('gzip'), SHARE_MAX_TEXT * 3 + 1024);
  } catch (err) {
    throw new ShareError('damaged', 'The link or the shared file is damaged.');
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch (err) {
    throw new ShareError('damaged', 'The shared file is damaged.');
  }
  if (!data || typeof data !== 'object' || !Number.isInteger(data.v)) throw new ShareError('damaged', 'The shared file is damaged.');
  if (data.v > SHARE_VERSION) throw new ShareError('version', 'This file was shared from a newer version of md-whatever. Reload to update.');
  if (typeof data.text !== 'string') throw new ShareError('damaged', 'The shared file is damaged.');
  const name = typeof data.name === 'string' && data.name.trim() ? baseName(data.name.trim()) : 'shared.md';
  return { name, text: data.text };
}

const shareLink = (origin, id, key) => `${origin.replace(/\/+$/, '')}/are/${id}#${key}`;

// A page address -> { id, key } when it's a share link (either may be null when
// that part is missing or mangled), else null. Punctuation a chat app glued to
// the end ("...#key)." ) is ignored.
function parseShareLink(href) {
  let url;
  try {
    url = new URL(href);
  } catch (err) {
    return null;
  }
  const path = /^\/are\/([^/]*)\/?$/.exec(url.pathname);
  if (!path) return null;
  const id = /^[0-9A-Za-z]{10}$/.test(path[1]) ? path[1] : null;
  const k = /^#([A-Za-z0-9_-]{22})[^A-Za-z0-9_-]*$/.exec(url.hash);
  return { id, key: k ? k[1] : null };
}

return {
  mix, paletteCss, scopeSelector, scopeCss,
  baseName, dirName, extOf, resolvePath, safeDecode, splitHref, hasScheme,
  titleOf,
  decodeBytes, encodeText, normalizeNewlines, lineEnding, withLineEnding,
  applyEdits, textDiff, wordAt, inlineOuter, toggleInline, setLink, removeLink,
  parseLine, blockAt, applyBlock, BLOCK_KINDS,
  SHARE_VERSION, ShareError, toBase64url, fromBase64url, packShare, unpackShare, shareLink, parseShareLink,
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = mdwLib;
