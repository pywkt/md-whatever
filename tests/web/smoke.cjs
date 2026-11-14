// End-to-end check of the built web reader in headless Chromium, driven over
// the DevTools protocol (the document lives in a shadow root, which a plain
// DOM dump wouldn't show).
//
//   node tests/web/smoke.cjs PAGE.html [--engine=wasm|js] [--online]
//
// --engine=js  removes WebAssembly from the page first, so the JavaScript
//              fallback runs (as in browsers that block wasm).
// --online     lets the page fetch highlight.js and MathJax from their CDNs and
//              checks code colors and math. Without it all http(s) requests are
//              blocked: the default under ctest, which must not need a network.
// Chromium: see cdp.cjs.
'use strict';
const path = require('node:path');
const { launch, PAGE_WAIT } = require('./cdp.cjs');

const args = process.argv.slice(2);
const page = args.find((a) => !a.startsWith('--'));
const engine = (args.find((a) => a.startsWith('--engine=')) || '--engine=wasm').slice(9);
const online = args.includes('--online');
if (!page || !['wasm', 'js'].includes(engine)) {
  console.error('usage: smoke.cjs PAGE.html [--engine=wasm|js] [--online]');
  process.exit(2);
}

async function main() {
  const b = await launch({ offline: !online });
  const failures = [];
  const check = (ok, what) => { if (!ok) failures.push(what); };
  try {
    const { send, evaluate } = b;
    // blocked CDN requests are expected offline; anything else logged as an error is not
    b.on('Log.entryAdded', ({ entry }) => {
      if (entry.level === 'error' && !(entry.url || '').startsWith('http')) b.problems.push('log: ' + entry.text);
    });
    await send('Log.enable');
    if (engine === 'js') await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete globalThis.WebAssembly;' });
    await b.load('file://' + path.resolve(page));

    // Wait for the welcome page, then for math to settle (online) or fall back (offline).
    const state = await evaluate(`(async () => {
      ${PAGE_WAIT}
      const host = document.getElementById('viewer');
      const art = await wait(() => host && host.shadowRoot && host.shadowRoot.querySelector('article h1') && host.shadowRoot.querySelector('article'), 10000);
      if (!art) return { started: false, url: location.href, empty: (document.getElementById('empty-title') || {}).textContent };
      await wait(() => !art.querySelector('code.math-pending'), ${online ? 15000 : 5000});
      const s = { started: true, engine: host.dataset.engine, h1: art.querySelector('h1').textContent,
        rail: [...document.querySelectorAll('.file-name')].map((n) => n.textContent),
        themes: [...document.querySelectorAll('#theme-select option')].map((o) => o.value),
        tasks: art.querySelectorAll('.task').length, footnotes: art.querySelectorAll('.footnotes li').length,
        mathSvg: art.querySelectorAll('svg.math').length, mathSource: art.querySelectorAll('code.math-source').length,
        mathPending: art.querySelectorAll('code.math-pending').length };
      // follow the link to the kitchen sink, inside the page
      [...art.querySelectorAll('a')].find((a) => a.getAttribute('href') === 'kitchen-sink.md').click();
      const ks = await wait(() => { const a = host.shadowRoot.querySelector('article'); return a && a.querySelector('h1').textContent === 'Kitchen Sink' && a; }, 5000);
      if (ks) {
        await wait(() => [...ks.querySelectorAll('img')].every((i) => i.complete), 3000);
        await wait(() => ks.querySelector('pre.code [class^="hljs-"]'), ${online ? 8000 : 300});
        s.ks = { tables: ks.querySelectorAll('table').length, hljs: ks.querySelectorAll('pre.code [class^="hljs-"]').length,
          localImages: [...ks.querySelectorAll('img')].filter((i) => i.naturalWidth > 0).length,
          imageNotes: ks.querySelectorAll('.mdw-img-note').length,
          rawHtmlEscaped: !ks.querySelector('script, b[onclick]') };
      }
      s.title = document.title;
      return s; })()`);

    console.log(JSON.stringify(state, null, 1));
    check(state && state.started, 'the page started and rendered the welcome page');
    if (state && state.started) {
      check(state.engine === engine, `engine is ${engine} (got ${state.engine})`);
      check(state.h1 === 'md-whatever, in a browser tab', 'welcome heading');
      check(state.rail.join() === 'welcome.md', 'sidebar shows only the welcome sample at start');
      check(state.themes[0] === 'default' && state.themes[1] === 'paper' && state.themes.length >= 2 && !state.themes.includes('base'),
        'theme menu: default, paper, then the examples (no base)');
      check(state.tasks === 6 && state.footnotes === 1, 'task list and footnote rendered');
      check(state.mathPending === 0, 'no equation left pending');
      if (online) check(state.mathSvg >= 1 && state.mathSource === 0, 'math typeset by MathJax');
      else check(state.mathSvg === 0 && state.mathSource >= 1, 'offline: math shown as TeX source');
      check(!!state.ks, 'link to kitchen-sink.md opened it');
      if (state.ks) {
        check(state.ks.tables === 2, 'kitchen sink tables');
        check(state.ks.localImages === 2, 'bundled images loaded');
        check(state.ks.imageNotes === 2, 'web images replaced by notes (web images off)');
        check(state.ks.rawHtmlEscaped, 'raw HTML stayed text');
        if (online) check(state.ks.hljs > 0, 'code colored by highlight.js');
        else check(state.ks.hljs === 0, 'offline: code left plain');
      }
      check(state.title === 'kitchen-sink.md · md-whatever Reader', 'window title follows the open file');
    }
    for (const p of b.problems) failures.push('page error: ' + p);
  } finally {
    await b.close();
  }

  if (failures.length) {
    console.error('FAIL:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log(`ok: ${engine} engine, ${online ? 'online' : 'offline'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
