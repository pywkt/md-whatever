// Sharing from the hosted web reader, in headless Chromium, against the real
// Worker (share/worker.js) with fake Cloudflare bindings (tests/share/fakes.mjs):
//   - the Share panel makes a link; only encrypted bytes reach the server
//   - opening the link shows the same file, name and text
//   - a changed document is noticed; the link is remembered after a reload
//   - Stop sharing deletes it; broken links explain themselves
//   - the page's Content-Security-Policy blocks nothing it needs
//
//   node tests/web/share.cjs SITE_DIR
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch, stop, PAGE_WAIT } = require('./cdp.cjs');

const siteArg = process.argv[2];
if (!siteArg) {
  console.error('usage: share.cjs SITE_DIR');
  process.exit(2);
}
const ROOT = path.join(__dirname, '..', '..');
const TEXT = '# Shared notes\r\n\r\nHello *world* 😀, with a secret: hunter2.\r\n';

// md.wtvr.sh on 127.0.0.1: every request goes through the Worker.
async function serveWorker(env) {
  const { default: worker } = await import(pathToFileURL(path.join(ROOT, 'share', 'worker.js')));
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const headers = Object.entries(req.headers).filter(([k]) => !['connection', 'keep-alive', 'transfer-encoding'].includes(k));
      const request = new Request(`http://${req.headers.host}${req.url}`,
        { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error(err);
      res.writeHead(500).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

async function main() {
  const site = fs.realpathSync(siteArg);
  const { fakeEnv } = await import(pathToFileURL(path.join(ROOT, 'tests', 'share', 'fakes.mjs')));
  const env = fakeEnv(site);
  const server = await serveWorker(env);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const b = await launch({ offline: true });
  const step = (what) => console.log('- ' + what);
  try {
    const { send, evaluate } = b;
    const waitFor = (expr, ms = 8000, what = expr) => evaluate(`(async () => { ${PAGE_WAIT}
      return await wait(async () => ${expr}, ${ms}); })()`).then((v) => { assert.ok(v, 'timed out waiting for ' + what); return v; });
    const h1 = `(document.getElementById('viewer').shadowRoot.querySelector('article h1') || {}).textContent`;
    const empty = `(!document.getElementById('empty').hidden && document.getElementById('empty-title').textContent)`;
    const paste = (text) => evaluate(`(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(text)});
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    })()`);
    const click = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
    const shown = (id) => evaluate(`!document.getElementById(${JSON.stringify(id)}).hidden`);
    const text = (id) => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);

    // Leaving a page with unsaved edits asks first: yes.
    b.on('Page.javascriptDialogOpening', () => send('Page.handleJavaScriptDialog', { accept: true }));
    // Anything the page's Content-Security-Policy blocks.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI), true);` });

    step('the hosted page has the Share button and its security headers');
    await b.load(origin + '/');
    await waitFor(`${h1} === 'md-whatever, in a browser tab'`);
    assert.ok(await shown('share'), 'Share is shown on the hosted page');
    const headers = await evaluate(`fetch('/').then((r) => r.headers.get('content-security-policy'))`);
    assert.match(headers, /connect-src 'self'/);

    step('a document is shared: the link, and only encrypted bytes on the server');
    await paste(TEXT);
    await waitFor(`${h1} === 'Shared notes'`);
    await click('share');
    assert.ok(await shown('share-panel'));
    assert.equal(await text('share-name'), 'pasted-1.md');
    assert.equal(await evaluate(`document.getElementById('share-days').value`), '7');
    assert.match(await text('share-note'), /Encrypted in your browser/);
    await evaluate(`document.getElementById('share-days').value = '30'`);
    await click('share-create');
    await waitFor(`!document.getElementById('share-made').hidden`, 8000, 'the link');
    const link = await evaluate(`document.getElementById('share-link').value`);
    assert.match(link, new RegExp(`^${origin}/are/[0-9A-Za-z]{10}#[A-Za-z0-9_-]{22}$`));
    const id = link.split('/are/')[1].split('#')[0];
    assert.deepEqual([...env.SHARES.objects.keys()], [id]);
    const stored = env.SHARES.objects.get(id);
    assert.doesNotMatch(Buffer.from(stored.bytes).toString('latin1'), /hunter2|Shared notes|pasted/);
    const days = (Date.parse(stored.customMetadata.expires) - Date.now()) / 864e5;
    assert.ok(days > 29.9 && days <= 30, `${days} days`);
    assert.match(await text('share-expires'), /^Expires /);
    assert.equal(await text('share-create'), 'Create a new link');

    step('a change after sharing is noticed');
    await click('mode'); // Edit
    await evaluate(`(() => {
      const ta = document.getElementById('viewer').shadowRoot.querySelector('textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      document.execCommand('insertText', false, 'More.\\n');
    })()`);
    await click('share');
    assert.ok(!(await shown('share-panel')), 'the button closes it');
    await click('share');
    await waitFor(`/changed pasted-1\\.md since/.test(document.getElementById('share-note').textContent)`, 3000, 'the changed note');

    step('opening the link shows the same file');
    await b.load(link);
    await waitFor(`${h1} === 'Shared notes'`, 8000, 'the shared file');
    assert.equal(await text('bar-name'), 'pasted-1.md');
    assert.match(await evaluate(`document.querySelector('#file-list .file-meta').textContent`), /^Shared · expires /);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('#file-list .file-name')].map((n) => n.textContent)`), ['pasted-1.md'],
      'instead of the welcome page');
    await click('mode');
    const source = await evaluate(`document.getElementById('viewer').shadowRoot.querySelector('textarea').value`);
    assert.equal(source, TEXT.replace(/\r\n/g, '\n'), 'the text, as the editor shows it');
    assert.equal(await evaluate(`location.pathname`), `/are/${id}`, 'the address stays the link');

    step('after a reload, the same document still knows its link, and Stop sharing removes it');
    await b.load(origin + '/');
    await waitFor(`${h1} === 'md-whatever, in a browser tab'`);
    await paste(TEXT);
    await waitFor(`${h1} === 'Shared notes'`);
    await click('share');
    assert.ok(await shown('share-made'), 'remembered');
    assert.equal(await evaluate(`document.getElementById('share-link').value`), link);
    await click('share-stop');
    await waitFor(`document.getElementById('share-made').hidden`, 5000, 'Stop sharing');
    assert.equal(env.SHARES.objects.size, 0);
    assert.equal(await evaluate(`localStorage.getItem('mdw-shares')`), '[]');

    step('links that no longer work, or never did, say why');
    await b.load(link);
    assert.equal(await waitFor(empty), 'This link has expired or was removed');
    await b.load(link.split('#')[0]);
    assert.equal(await waitFor(empty), 'This link is incomplete');
    // a working link, with another key
    await b.load(origin + '/');
    await waitFor(`${h1}`);
    await paste('# Two\n');
    await waitFor(`${h1} === 'Two'`);
    await click('share');
    await click('share-create');
    await waitFor(`!document.getElementById('share-made').hidden`);
    const two = await evaluate(`document.getElementById('share-link').value`);
    await b.load(two.replace(/#.*/, '#' + 'A'.repeat(21) + 'Q'));
    assert.equal(await waitFor(empty), 'This link is damaged');
    // the empty state's own words come back once a document shows
    await click('empty-welcome');
    await waitFor(`${h1} === 'md-whatever, in a browser tab'`);
    await evaluate(`document.querySelector('#file-list .file-close').click()`);
    assert.equal(await waitFor(empty), 'No files open');

    step('expired on the server');
    await b.load(origin + '/'); // the address differs from the damaged one only after the #: load something else first
    await b.load(two);
    await waitFor(`${h1} === 'Two'`);
    const twoId = two.split('/are/')[1].split('#')[0];
    env.SHARES.objects.get(twoId).customMetadata.expires = new Date(Date.now() - 1000).toISOString();
    await b.load(null); // reload (navigating to the same address would only move to its #part)
    assert.equal(await waitFor(empty), 'This link has expired or was removed');

    step('nothing was blocked or broken');
    assert.deepEqual(await evaluate('window.__csp'), [], 'Content-Security-Policy violations');
    assert.deepEqual(b.problems, [], 'page errors');
    console.log('share: all checks passed');
  } finally {
    await b.close();
    await stop(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
