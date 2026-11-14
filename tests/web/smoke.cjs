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
// Chromium: $MDW_CHROMIUM, or chromium / google-chrome-stable on PATH.
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const page = args.find((a) => !a.startsWith('--'));
const engine = (args.find((a) => a.startsWith('--engine=')) || '--engine=wasm').slice(9);
const online = args.includes('--online');
if (!page || !['wasm', 'js'].includes(engine)) {
  console.error('usage: smoke.cjs PAGE.html [--engine=wasm|js] [--online]');
  process.exit(2);
}

function findChromium() {
  if (process.env.MDW_CHROMIUM) return process.env.MDW_CHROMIUM;
  for (const name of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    try { return execFileSync('which', [name]).toString().trim(); } catch { /* next */ }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chromium = findChromium();
  if (!chromium) {
    console.log('SKIP: no Chromium found (set MDW_CHROMIUM)');
    process.exit(77); // ctest SKIP_RETURN_CODE
  }
  // Chromium puts a Unix socket in its temp dir and refuses to start if that
  // path is too long (sockets are limited to ~100 bytes), so use /tmp then.
  const tmp = os.tmpdir().length <= 60 ? os.tmpdir() : '/tmp';
  const profile = fs.mkdtempSync(path.join(tmp, 'mdw-smoke-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const browser = spawn(chromium, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'],
  { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: tmp } });

  const problems = [];
  const failures = [];
  const check = (ok, what) => { if (!ok) failures.push(what); };
  try {
    let target;
    for (let i = 0; i < 100 && !target; i++) { // up to ~10 s
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
      } catch { /* not listening yet */ }
      if (!target) await sleep(100);
    }
    if (!target) throw new Error('Chromium did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
    let id = 0;
    const pending = new Map();
    let loaded;
    const loadFired = new Promise((r) => { loaded = r; });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Page.loadEventFired') loaded();
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        problems.push('exception: ' + ((d.exception && d.exception.description) || d.text));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        problems.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
      // blocked CDN requests are expected offline; anything else logged as an error is not
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !(m.params.entry.url || '').startsWith('http'))
        problems.push('log: ' + m.params.entry.text);
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) throw new Error('evaluate: ' + JSON.stringify(r.result.exceptionDetails));
      return r.result && r.result.result && r.result.result.value;
    };
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Network.enable');
    if (!online) await send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
    await send('Page.enable');
    if (engine === 'js') await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete globalThis.WebAssembly;' });
    await send('Page.navigate', { url: 'file://' + path.resolve(page) });
    // navigate answers before the page has loaded; evaluating now would run in about:blank
    let timer;
    await Promise.race([loadFired, new Promise((_, j) => { timer = setTimeout(() => j(new Error('the page did not load')), 15000); })]);
    clearTimeout(timer);

    // Wait for the welcome page, then for math to settle (online) or fall back (offline).
    const state = await evaluate(`(async () => {
      const wait = async (fn, ms) => { for (let t = 0; t < ms; t += 50) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };
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
    for (const p of problems) failures.push('page error: ' + p);
    ws.close();
  } finally {
    try { process.kill(-browser.pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 50; i++) { // wait until nothing uses the profile, then delete it
      try { execFileSync('pgrep', ['-f', 'user-data-dir=' + profile]); await sleep(100); } catch { break; }
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  if (failures.length) {
    console.error('FAIL:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  console.log(`ok: ${engine} engine, ${online ? 'online' : 'offline'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
