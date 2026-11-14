// Headless Chromium driven over the DevTools protocol, shared by smoke.cjs and
// site.cjs. Chromium: $MDW_CHROMIUM, or chromium / google-chrome-stable on PATH;
// without one, scripts exit 77 (ctest's SKIP_RETURN_CODE).
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChromium() {
  if (process.env.MDW_CHROMIUM) return process.env.MDW_CHROMIUM; // used as given: missing is an error, not a skip
  for (const name of ['chromium', 'google-chrome-stable', 'google-chrome']) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      const file = path.join(dir, name);
      try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { /* next */ }
    }
  }
  return null;
}

// Starts Chromium and attaches to its first tab. offline: every non-loopback
// request fails (an unreachable proxy; loopback is never proxied), including
// requests from service workers, which page-level request blocking misses.
async function launch({ offline = false } = {}) {
  const chromium = findChromium();
  if (!chromium) {
    console.log('SKIP: no Chromium found (set MDW_CHROMIUM)');
    process.exit(77);
  }
  // Chromium puts a Unix socket in its temp dir and refuses to start if that
  // path is too long (sockets are limited to ~100 bytes), so use /tmp then.
  const tmp = os.tmpdir().length <= 60 ? os.tmpdir() : '/tmp';
  const profile = fs.mkdtempSync(path.join(tmp, 'mdw-cdp-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu'];
  if (offline) args.push('--proxy-server=http://127.0.0.1:9');
  if (process.getuid && process.getuid() === 0) args.push('--no-sandbox'); // CI containers run as root
  const browser = spawn(chromium, [...args, 'about:blank'],
    { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: tmp } });

  async function close() {
    try { process.kill(-browser.pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 50; i++) { // wait until nothing uses the profile, then delete it
      try { execFileSync('pgrep', ['-f', 'user-data-dir=' + profile]); await sleep(100); } catch { break; }
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

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
    const listeners = [];
    const problems = []; // page exceptions and console errors
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        problems.push('exception: ' + ((d.exception && d.exception.description) || d.text));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        problems.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
      for (const l of listeners.slice()) if (l.method === m.method) l.fn(m.params);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const on = (method, fn) => listeners.push({ method, fn });
    const once = (method, ms = 15000) => new Promise((resolve, reject) => {
      const l = { method, fn: (p) => { listeners.splice(listeners.indexOf(l), 1); clearTimeout(t); resolve(p); } };
      const t = setTimeout(() => { listeners.splice(listeners.indexOf(l), 1); reject(new Error(`no ${method} within ${ms} ms`)); }, ms);
      listeners.push(l);
    });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('evaluate: ' + ((d.exception && d.exception.description) || d.text));
      }
      return r.result && r.result.value;
    };
    // Navigates (or reloads, with url null) and waits for the load event.
    const load = async (url) => {
      const loaded = once('Page.loadEventFired');
      if (url) await send('Page.navigate', { url });
      else await send('Page.reload', {});
      await loaded;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    return { send, evaluate, on, once, load, problems, close: async () => { ws.close(); await close(); } };
  } catch (err) {
    await close();
    throw err;
  }
}

// Runs in the page: waits up to ms for fn() to return something truthy.
const PAGE_WAIT = 'const wait = async (fn, ms) => { for (let t = 0; t < ms; t += 50) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } return null; };';

module.exports = { launch, sleep, PAGE_WAIT };
