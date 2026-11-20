// The old address (pywkt.github.io/md-whatever) after the move, in headless
// Chromium: web/moved/ replaces the site there.
//   - a copy that was installed (service worker in charge) gets the farewell
//     service worker on its next start, lands on md.wtvr.sh/?moved=1, and
//     leaves no service worker or cache behind
//   - a plain visit forwards to md.wtvr.sh, keeping the #part
// md.wtvr.sh itself is answered by the test (request interception).
//
//   node tests/web/moved.cjs SITE_DIR MOVED_DIR
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, serve, stop, PAGE_WAIT } = require('./cdp.cjs');

const [siteArg, movedArg] = process.argv.slice(2);
if (!siteArg || !movedArg) {
  console.error('usage: moved.cjs SITE_DIR MOVED_DIR');
  process.exit(2);
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mdw-moved-'));
  fs.cpSync(fs.realpathSync(siteArg), work, { recursive: true });
  const server = await serve(work);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const b = await launch({ offline: true });
  const step = (what) => console.log('- ' + what);
  try {
    const { send, evaluate } = b;
    const waitFor = (expr, ms = 10000, what = expr) => evaluate(`(async () => { ${PAGE_WAIT}
      return await wait(async () => ${expr}, ${ms}); })()`).then((v) => { assert.ok(v, 'timed out waiting for ' + what); return v; });

    // md.wtvr.sh: a page that says where it is.
    const arrivals = [];
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://md.wtvr.sh/*' }] });
    b.on('Fetch.requestPaused', (p) => {
      arrivals.push(p.request.url);
      send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from('<!doctype html><title>md.wtvr.sh</title>new home').toString('base64') });
    });

    step('the reader, installed: its service worker is in charge');
    await b.load(url);
    await waitFor('navigator.serviceWorker.controller', 10000, 'the service worker');
    assert.ok((await evaluate('caches.keys()')).length > 0);

    step('the old address now serves web/moved/');
    for (const name of fs.readdirSync(movedArg)) fs.copyFileSync(path.join(movedArg, name), path.join(work, name));

    step('the next start: the farewell service worker sends the window to md.wtvr.sh');
    const landed = b.once('Page.frameNavigated', 15000);
    await send('Page.reload', {});
    let nav = await landed;
    for (let i = 0; i < 5 && !nav.frame.url.startsWith('https://md.wtvr.sh/'); i++) nav = await b.once('Page.frameNavigated', 15000);
    assert.equal(nav.frame.url, 'https://md.wtvr.sh/?moved=1');

    step('nothing of the old version is left at the old address');
    await b.load(url + 'sw.js'); // a plain file there: shown, not forwarded
    assert.deepEqual(await evaluate('navigator.serviceWorker.getRegistrations().then((r) => r.length)'), 0, 'service workers');
    assert.deepEqual(await evaluate('caches.keys()'), [], 'caches');

    step('a first visit forwards, keeping the #part');
    // (a browser that still has the old page in its HTTP cache - GitHub Pages
    // says max-age=600 - gets the farewell service worker instead, as above)
    await send('Network.clearBrowserCache');
    arrivals.length = 0;
    const toNew = async () => {
      for (;;) {
        const n = await b.once('Page.frameNavigated', 10000);
        if (n.frame.url.startsWith('https://md.wtvr.sh/')) return n.frame.url;
      }
    };
    const forwarded = toNew();
    await send('Page.navigate', { url: url + '#section' });
    assert.equal(await forwarded, 'https://md.wtvr.sh/?moved=1');
    assert.equal(await waitFor('document.title === "md.wtvr.sh" && location.href'), 'https://md.wtvr.sh/?moved=1#section');
    assert.deepEqual(arrivals, ['https://md.wtvr.sh/?moved=1'], 'the #part is never sent');
    console.log('moved: all checks passed');
  } finally {
    await b.close();
    await stop(server);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
