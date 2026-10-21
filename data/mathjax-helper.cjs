// md-whatever math helper: TeX -> SVG with MathJax 4, run under node.
//
// Usage: node mathjax-helper.cjs <mathjax-dir> <font-dir>
// Protocol: one JSON object per line on stdin  {"id": "...", "tex": "...", "display": bool}
//           one JSON object per line on stdout {"id": "...", "svg": "..."} or {"id": "...", "error": "..."}
// Reads only local files. Never touches the network.
'use strict';

const path = require('path');
const readline = require('readline');

const [mathjaxDir, fontDir] = process.argv.slice(2);
if (!mathjaxDir || !fontDir) {
  process.stderr.write('usage: mathjax-helper.cjs <mathjax-dir> <font-dir>\n');
  process.exit(2);
}

global.MathJax = {
  loader: {
    paths: { mathjax: mathjaxDir, 'mathjax-newcm': fontDir },
    load: ['adaptors/liteDOM'],
    require: (file) => require(file.replace(/^file:\/\//, '')),
  },
  startup: {
    adaptor: 'liteAdaptor',
    typeset: false,
    pageReady: () => Promise.resolve(), // no page to wait for
  },
  tex: {
    packages: { '[+]': ['ams', 'noundefined'] },
    formatError: (jax, err) => { throw err; }, // report errors to the app instead of drawing them
  },
  svg: { fontCache: 'local', linebreaks: { inline: false } },
  options: { enableEnrichment: false, enableSpeech: false, enableBraille: false },
};

// Silence MathJax console chatter so stdout stays pure protocol.
console.log = console.info = (...a) => process.stderr.write(a.join(' ') + '\n');

require(path.join(mathjaxDir, 'tex-svg.js'));

function strip(svg) {
  // drop bookkeeping attributes the viewer doesn't need
  return svg.replace(/ data-[a-z0-9-]+="[^"]*"/g, '').replace(/ (role|focusable|aria-hidden)="[^"]*"/g, '');
}

// --- Flatten nested <svg> elements -----------------------------------------
// MathJax draws the middle "extender" of tall brackets and braces as a
// scaled glyph inside a nested <svg> that clips it. Qt's SVG renderer
// (SVG Tiny 1.2) skips nested <svg>, leaving gaps. An extender is uniform
// along its stretch axis, so scaling it to exactly the visible window looks
// the same as clipping it. We rewrite each nested <svg> into plain <use>
// elements with a matrix() transform.

function pathBox(svg, id) {
  const m = svg.match(new RegExp('<path id="' + id.replace(/[-]/g, '\\-') + '" d="([^"]*)"'));
  if (!m) return null;
  const nums = m[1].match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
  if (!nums || nums.length < 2) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) { // MathJax font paths use absolute coordinate pairs
    const x = +nums[i], y = +nums[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, x1, y0, y1 };
}

function parseTransform(t) { // translate/scale only: x' = a x + e, y' = d y + f
  let a = 1, d = 1, e = 0, f = 0;
  const ops = [...(t || '').matchAll(/(translate|scale)\(([^)]*)\)/g)];
  for (let i = ops.length - 1; i >= 0; i--) { // rightmost applies first
    const v = ops[i][2].split(/[ ,]+/).filter(Boolean).map(Number);
    if (ops[i][1] === 'translate') { e += v[0] || 0; f += v[1] || 0; }
    else { const sx = v[0], sy = v.length > 1 ? v[1] : v[0]; a *= sx; d *= sy; e *= sx; f *= sy; }
  }
  return { a, d, e, f };
}

function fitAxis(g0, g1, scale, offset, w0, w1) {
  // glyph interval [g0,g1] mapped by scale/offset, clipped to window [w0,w1]
  const t0 = scale * g0 + offset, t1 = scale * g1 + offset;
  const lo = Math.max(Math.min(t0, t1), w0), hi = Math.min(Math.max(t0, t1), w1);
  if (hi <= lo) return null;
  if (lo === Math.min(t0, t1) && hi === Math.max(t0, t1)) return { s: scale, o: offset }; // not clipped
  const s = (hi - lo) / (g1 - g0);
  return { s, o: lo - s * g0 };
}

function flattenNested(svg) {
  // innermost <svg> elements (no <svg> inside); attributes in any order
  const re = /<svg ([^>]*)>((?:(?!<svg)[\s\S])*?)<\/svg>/g;
  return svg.replace(re, (all, attrText, inner) => {
    const attr = (n) => { const m = attrText.match(new RegExp('(?:^| )' + n + '="([^"]*)"')); return m ? m[1] : null; };
    if (attr('x') === null || attr('y') === null || attr('viewBox') === null) return all; // the root, not nested
    let [VX, VY, VW, VH] = attr('viewBox').split(/[ ,]+/).map(Number);
    let W = +attr('width'), H = +attr('height'), X = +attr('x'), Y = +attr('y');
    const kx = W / VW, ky = H / VH;
    const uses = [...inner.matchAll(/<use ([^>]*?)\/>/g)];
    const rest = inner.replace(/<use [^>]*?\/>/g, '').trim();
    let out = '';
    for (const u of uses) {
      const href = (u[1].match(/xlink:href="#([^"]+)"/) || [])[1];
      const tf = parseTransform((u[1].match(/transform="([^"]*)"/) || [])[1]);
      const box = href && pathBox(svg, href);
      if (!box) { out += `<g transform="matrix(${kx} 0 0 ${ky} ${X - kx * VX} ${Y - ky * VY})"><use ${u[1]}/></g>`; continue; }
      const fx = fitAxis(box.x0, box.x1, tf.a, tf.e, VX, VX + VW);
      const fy = fitAxis(box.y0, box.y1, tf.d, tf.f, VY, VY + VH);
      if (!fx || !fy) continue; // entirely clipped away
      const a = kx * fx.s, e = X + kx * (fx.o - VX), d = ky * fy.s, f = Y + ky * (fy.o - VY);
      const attrs = u[1].replace(/ ?transform="[^"]*"/, '');
      out += `<use ${attrs} transform="matrix(${+a.toFixed(4)} 0 0 ${+d.toFixed(4)} ${+e.toFixed(2)} ${+f.toFixed(2)})"/>`;
    }
    if (rest) // anything else: keep it, positioned but unclipped
      out += `<g transform="matrix(${kx} 0 0 ${ky} ${X - kx * VX} ${Y - ky * VY})">${rest}</g>`;
    return out;
  });
}

async function render(tex, display) {
  // Synchronous render; if a font range must be loaded first, wait and redo it.
  // (The async API keeps a stale size after a mid-render font load.)
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const node = MathJax.tex2svg(tex, { display });
      const adaptor = MathJax.startup.adaptor;
      const svg = adaptor.firstChild(node);
      return flattenNested(strip(adaptor.serializeXML(svg)));
    } catch (err) {
      if (err && err.retry) { await err.retry; continue; }
      throw err;
    }
  }
  throw new Error('too many font loads');
}

const queue = [];
let busy = false;

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const req = queue.shift();
    let reply;
    try {
      reply = { id: req.id, svg: await render(String(req.tex), !!req.display) };
    } catch (err) {
      reply = { id: req.id, error: String((err && err.message) || err) };
    }
    process.stdout.write(JSON.stringify(reply) + '\n');
  }
  busy = false;
}

MathJax.startup.promise.then(() => {
  process.stdout.write(JSON.stringify({ ready: true }) + '\n');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try { queue.push(JSON.parse(line)); } catch (e) { return; }
    pump();
  });
  rl.on('close', () => { const wait = () => (busy || queue.length ? setTimeout(wait, 10) : process.exit(0)); wait(); });
}).catch((err) => {
  process.stderr.write('MathJax startup failed: ' + err + '\n');
  process.exit(1);
});
