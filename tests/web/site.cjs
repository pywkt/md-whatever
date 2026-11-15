// The hosted web reader (build/web/site, what GitHub Pages serves), on a local
// server in headless Chromium:
//   - the manifest loads and Chromium finds nothing that blocks installing it
//   - the service worker takes over, and the page then opens with the server gone
//   - files handed over by the OS (launchQueue) open, live-reload, and are
//     listed under Recent, which survives a restart and reopens them
//   - a new version shows the update notice, and "Reload now" switches to it
//
//   node tests/web/site.cjs SITE_DIR [--online]
//
// --online also lets the page reach the CDNs and checks that highlight.js and
// MathJax land in the service worker's cache. Chromium: see cdp.cjs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, serve, stop, sleep, PAGE_WAIT } = require('./cdp.cjs');

const args = process.argv.slice(2);
const siteArg = args.find((a) => !a.startsWith('--'));
const online = args.includes('--online');
if (!siteArg) {
  console.error('usage: site.cjs SITE_DIR [--online]');
  process.exit(2);
}

// The page's state, as the tests need it.
const STATE = `(() => {
  const host = document.getElementById('viewer');
  const art = host.shadowRoot && host.shadowRoot.querySelector('article');
  return {
    h1: art && art.querySelector('h1') ? art.querySelector('h1').textContent : null,
    open: [...document.querySelectorAll('#file-list .file-name')].map((n) => n.textContent),
    recent: [...document.querySelectorAll('#recent-list .file-name')].map((n) => n.textContent),
    recentShown: !document.getElementById('recent').hidden,
    live: !document.getElementById('live').hidden,
    update: !document.getElementById('update').hidden,
    controlled: !!navigator.serviceWorker.controller,
  };
})()`;

async function main() {
  const site = fs.realpathSync(siteArg);
  // A copy the test can change (to publish a "new version") without touching the build.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mdw-site-'));
  fs.cpSync(site, work, { recursive: true });
  let server = await serve(work);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  const b = await launch({ offline: !online });
  const step = (what) => console.log('- ' + what);
  try {
    const { send, evaluate } = b;
    const waitFor = (expr, ms = 10000, what = expr) => evaluate(`(async () => { ${PAGE_WAIT}
      return await wait(async () => ${expr}, ${ms}); })()`).then((v) => { assert.ok(v, 'timed out waiting for ' + what); return v; });
    const state = () => evaluate(STATE);

    // Files "from Finder": the OS hands file handles to launchQueue. Headless
    // Chromium has no OS to do that, so the page gets a stand-in launchQueue,
    // and real handles from its private file system (navigator.storage).
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(window, 'launchQueue', { configurable: true, value: {
        setConsumer(fn) { window.__launch = fn; },
      } });` });

    step('opens, with an installable manifest');
    await b.load(url);
    await waitFor(`document.getElementById('viewer').shadowRoot.querySelector('article h1')`);
    assert.equal((await state()).h1, 'md-whatever, in a browser tab');
    const manifest = await send('Page.getAppManifest');
    assert.deepEqual(manifest.errors, [], 'manifest errors');
    assert.equal(manifest.url, url + 'manifest.webmanifest');
    const m = JSON.parse(manifest.data);
    assert.deepEqual(m.file_handlers[0].accept['text/markdown'], ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn']);
    for (const icon of m.icons) {
      const status = await evaluate(`fetch(${JSON.stringify(icon.src)}).then((r) => r.status)`);
      assert.equal(status, 200, icon.src);
    }

    step('the service worker takes over and caches the site');
    await waitFor('navigator.serviceWorker.controller', 10000, 'the service worker to take over');
    const cached = await evaluate(`(async () => {
      const names = await caches.keys();
      const siteCache = names.find((n) => n.startsWith('mdw-site-'));
      return { names, entries: (await (await caches.open(siteCache)).keys()).map((r) => new URL(r.url).pathname).sort() };
    })()`);
    assert.deepEqual(cached.entries, ['/', '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png',
      '/icons/icon.svg', '/icons/maskable-512.png', '/manifest.webmanifest']);
    const installability = await send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, [], 'installability');

    step('a file from the OS opens, is watched, and is listed under Recent');
    await evaluate(`(async () => {
      const dir = await navigator.storage.getDirectory();
      const file = await dir.getFileHandle('from-finder.md', { create: true });
      const w = await file.createWritable();
      await w.write('# From Finder\\n\\nfirst version\\n');
      await w.close();
      window.__launch({ files: [file] });
    })()`);
    await waitFor(`document.getElementById('bar-name').textContent === 'from-finder.md'`);
    let s = await state();
    assert.equal(s.h1, 'From Finder');
    assert.deepEqual(s.open, ['from-finder.md'], 'the welcome sample made way');
    assert.ok(s.live, 'live reload is on for a file with a handle');
    await waitFor(`!document.getElementById('recent').hidden`, 3000, 'the Recent list');
    assert.deepEqual((await state()).recent, ['from-finder.md']);
    await evaluate(`(async () => {
      const file = await (await navigator.storage.getDirectory()).getFileHandle('from-finder.md');
      const w = await file.createWritable();
      await w.write('# Edited elsewhere\\n');
      await w.close();
    })()`);
    await waitFor(`document.getElementById('viewer').shadowRoot.querySelector('article h1').textContent === 'Edited elsewhere'`,
      5000, 'live reload');

    step('the same file again does not add a second Recent row');
    await evaluate(`(async () => {
      window.__launch({ files: [await (await navigator.storage.getDirectory()).getFileHandle('from-finder.md')] });
    })()`);
    await sleep(500);
    s = await state();
    assert.deepEqual(s.recent, ['from-finder.md']);
    assert.deepEqual(s.open, ['from-finder.md']);

    step('with the server gone, the page still opens and Recent reopens the file');
    await stop(server);
    await b.load(url + '?from=homescreen');
    await waitFor(`document.getElementById('viewer').shadowRoot.querySelector('article h1')`);
    await waitFor(`!document.getElementById('recent').hidden`, 3000, 'the Recent list after a restart');
    s = await state();
    assert.equal(s.h1, 'md-whatever, in a browser tab');
    assert.deepEqual(s.recent, ['from-finder.md']);
    await evaluate(`document.querySelector('#recent-list .file-main').click()`);
    await waitFor(`document.getElementById('bar-name').textContent === 'from-finder.md'`, 5000, 'Recent to reopen the file');
    assert.equal((await state()).h1, 'Edited elsewhere');

    step('a new version shows the notice, and "Reload now" switches to it');
    server = await serve(work, port);
    const sw = path.join(work, 'sw.js');
    fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const VERSION = '[^']*'/, "const VERSION = 'test-next'"));
    await evaluate(`navigator.serviceWorker.getRegistration().then((r) => r.update())`);
    await waitFor(`!document.getElementById('update').hidden`, 10000, 'the update notice');
    const reloaded = b.once('Page.loadEventFired');
    await evaluate(`document.getElementById('update-reload').click()`);
    await reloaded;
    await waitFor(`navigator.serviceWorker.controller`);
    const after = await evaluate(`caches.keys()`);
    assert.ok(after.includes('mdw-site-test-next'), 'the new version is in charge: ' + after);
    assert.ok(!after.some((n) => n.startsWith('mdw-site-') && n !== 'mdw-site-test-next'), 'the old version was removed: ' + after);
    assert.equal((await state()).update, false);

    if (online) {
      step('online: highlight.js and MathJax are cached for offline use');
      await b.load(url); // the welcome page has math
      await waitFor(`document.getElementById('viewer').shadowRoot.querySelector('svg.math')`, 20000, 'MathJax');
      await evaluate(`[...document.getElementById('viewer').shadowRoot.querySelectorAll('a')].find((a) => a.getAttribute('href') === 'kitchen-sink.md').click()`);
      await waitFor(`document.getElementById('viewer').shadowRoot.querySelector('pre.code [class^="hljs-"]')`, 10000, 'highlight.js');
      const cdn = await evaluate(`caches.open('mdw-cdn-1').then((c) => c.keys()).then((k) => k.map((r) => r.url))`);
      console.log('  cached from CDNs:\n    ' + cdn.join('\n    '));
      assert.ok(cdn.some((u) => u.includes('highlight.min.js')), 'highlight.js cached');
      assert.ok(cdn.some((u) => u.includes('tex-svg.js')), 'MathJax cached');
    }

    assert.deepEqual(b.problems, [], 'page errors');
  } finally {
    await b.close();
    await stop(server).catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`ok: hosted site${online ? ', online' : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
