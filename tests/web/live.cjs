// The formatting toolbar in the web reader, in headless Chromium:
//   - t / the bar button show it; Read mode then renders with the source map
//   - a selection in the rendered page + Ctrl+B / the buttons change the
//     Markdown source, re-render, and keep the selection on the same text
//   - Read-mode undo/redo; block types (heading, list); links (the URL field);
//     links aren't followed by a plain click while formatting
//   - the result saves like any edit (in place, byte for byte)
//   - Edit mode: the same actions on the textarea, undone natively
//
//   node tests/web/live.cjs PAGE.html
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launch, serve, stop, sleep, PAGE_WAIT } = require('./cdp.cjs');

const pageArg = process.argv[2];
if (!pageArg) {
  console.error('usage: live.cjs PAGE.html');
  process.exit(2);
}
const utf8 = (s) => [...Buffer.from(s, 'utf8')];

const NOTES = '# Notes\r\n\r\nHello brave world.\r\n\r\nSecond paragraph here.\r\n\r\nSee [the docs](https://example.com) now.\r\n';

async function main() {
  const page = fs.realpathSync(pageArg);
  const server = await serve(path.dirname(page));
  const url = `http://127.0.0.1:${server.address().port}/${path.basename(page)}`;
  const b = await launch({ offline: true });
  const step = (what) => console.log('- ' + what);
  try {
    const { send, evaluate } = b;
    const waitFor = (expr, ms = 5000, what = expr) => evaluate(`(async () => { ${PAGE_WAIT}
      return await wait(async () => ${expr}, ${ms}); })()`).then((v) => { assert.ok(v, 'timed out waiting for ' + what); return v; });
    b.on('Page.javascriptDialogOpening', () => send('Page.handleJavaScriptDialog', { accept: true }));

    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn) { window.__launch = fn; } } });
      window.__files = {
        async write(name, bytes) {
          const h = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
          const w = await h.createWritable();
          await w.write(new Uint8Array(bytes));
          await w.close();
          return h;
        },
        async read(name) {
          const h = await (await navigator.storage.getDirectory()).getFileHandle(name);
          return [...new Uint8Array(await (await h.getFile()).arrayBuffer())];
        },
        async launch(name, bytes) { window.__launch({ files: [await this.write(name, bytes)] }); },
      };
      // Selections in the document, as a reader would make them with the mouse.
      window.__sel = {
        root: () => document.getElementById('viewer').shadowRoot,
        // the n-th occurrence of text inside the article, as a range of text nodes
        find(text, n = 0) {
          const art = this.root().querySelector('article');
          const walk = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
          const nodes = [];
          let all = '';
          for (let t = walk.nextNode(); t; t = walk.nextNode()) { nodes.push([t, all.length]); all += t.data; }
          let at = -1;
          for (let i = 0; i <= n; i++) at = all.indexOf(text, at + 1);
          if (at < 0) throw new Error('not in the page: ' + text);
          const point = (p, end) => {
            for (const [t, o] of nodes) if (p >= o && (end ? p <= o + t.length : p < o + t.length)) return [t, p - o];
            throw new Error('no point ' + p);
          };
          return [...point(at, false), ...point(at + text.length, true)];
        },
        select(text, n) { const [a, ao, b, bo] = this.find(text, n); document.getSelection().setBaseAndExtent(a, ao, b, bo); },
        caret(text, k = 0) { const [a, ao] = this.find(text); document.getSelection().setBaseAndExtent(a, ao + k, a, ao + k); },
        text() {
          const sel = document.getSelection();
          const [r] = sel.getComposedRanges({ shadowRoots: [this.root()] });
          if (!r) return null;
          const range = document.createRange();
          range.setStart(r.startContainer, r.startOffset);
          range.setEnd(r.endContainer, r.endOffset);
          return range.toString();
        },
      };` });
    await b.load(url);
    await waitFor(`document.getElementById('viewer').shadowRoot.querySelector('article h1')`);

    const S = `document.getElementById('viewer').shadowRoot`;
    const art = (expr) => evaluate(`(() => { const art = ${S}.querySelector('article'); return ${expr}; })()`);
    const key = async (keyName, code, vk, modifiers = 0) => {
      const k = { key: keyName, code, windowsVirtualKeyCode: vk, modifiers };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    };
    const CTRL = 2;
    const SHIFT = 8;
    const press = {
      t: () => key('t', 'KeyT', 84),
      e: () => key('e', 'KeyE', 69),
      esc: () => key('Escape', 'Escape', 27),
      enter: async () => { // with its text, as a real key sends it: that's what submits a form
        const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...k });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
      },
      bold: () => key('b', 'KeyB', 66, CTRL),
      italic: () => key('i', 'KeyI', 73, CTRL),
      link: () => key('k', 'KeyK', 75, CTRL),
      undo: () => key('z', 'KeyZ', 90, CTRL),
      redo: () => key('Z', 'KeyZ', 90, CTRL | SHIFT),
      save: () => key('s', 'KeyS', 83, CTRL),
    };
    // selectionchange is async: let the page see the new selection first
    const select = async (text, n = 0) => { await evaluate(`window.__sel.select(${JSON.stringify(text)}, ${n})`); await sleep(60); };
    const caret = async (text, k = 0) => { await evaluate(`window.__sel.caret(${JSON.stringify(text)}, ${k})`); await sleep(60); };
    const selected = () => evaluate('window.__sel.text()');
    const button = (fmt) => evaluate(`document.querySelector('#format [data-fmt="${fmt}"]').click()`);
    const pressed = (fmt) => evaluate(`document.querySelector('#format [data-fmt="${fmt}"]').getAttribute('aria-pressed')`);
    const toastSays = (text) => waitFor(`!document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes(${JSON.stringify(text)})`,
      5000, `the toast "${text}"`);

    step('t shows the toolbar; Read mode then renders with the source map');
    assert.equal(await evaluate(`document.getElementById('format').hidden`), true, 'hidden at first');
    assert.equal(await art(`art.querySelectorAll('[data-s]').length`), 0, 'no source map without the toolbar');
    await evaluate(`window.__files.launch('notes.md', ${JSON.stringify(utf8(NOTES))})`);
    await waitFor(`document.getElementById('bar-name').textContent === 'notes.md'`);
    assert.equal(await evaluate(`document.getElementById('share').hidden`), true, 'no Share in the single-file page');
    await press.t();
    await waitFor(`!document.getElementById('format').hidden`, 2000, 'the toolbar');
    assert.equal(await evaluate(`document.getElementById('format-toggle').getAttribute('aria-pressed')`), 'true');
    assert.ok(await art(`art.querySelectorAll('span[data-s]').length > 5`), 'mapped');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('md-whatever-reader')).toolbar`), true, 'remembered');

    step('select a word, Ctrl+B: bold in the source, the selection stays on it');
    await select('brave');
    await press.bold();
    await waitFor(`${S}.querySelector('article strong')`, 2000, 'bold text');
    assert.equal(await art(`art.querySelector('strong').textContent`), 'brave');
    assert.equal(await selected(), 'brave');
    assert.equal(await evaluate(`document.getElementById('bar-name').textContent`), '• notes.md', 'unsaved');
    await sleep(150);
    assert.equal(await pressed('strong'), 'true', 'the Bold button shows it');

    step('Ctrl+B again takes it away; Ctrl+Z / Ctrl+Shift+Z undo and redo that');
    await press.bold();
    await waitFor(`!${S}.querySelector('article strong')`, 2000, 'bold gone');
    assert.equal(await selected(), 'brave');
    await press.undo();
    await waitFor(`${S}.querySelector('article strong')`, 2000, 'undo: bold again');
    await press.redo();
    await waitFor(`!${S}.querySelector('article strong')`, 2000, 'redo: bold gone again');
    await press.undo();
    await waitFor(`${S}.querySelector('article strong')`, 2000, 'bold for the rest');

    step('part of a bold word, italic across it: markers never interleave');
    await select('rave world');
    await press.italic();
    await waitFor(`${S}.querySelector('article em')`, 2000, 'italic');
    assert.equal(await art(`art.querySelector('em').textContent`), 'brave world', 'widened over the bold word');

    step('the caret in a paragraph, block type Heading 2');
    await caret('Second paragraph', 3);
    await evaluate(`(() => { const s = document.getElementById('fmt-block'); s.value = 'h2'; s.dispatchEvent(new Event('change')); })()`);
    await waitFor(`${S}.querySelector('article h2')`, 2000, 'a heading');
    assert.equal(await art(`art.querySelector('h2').textContent`), 'Second paragraph here.');
    await sleep(150);
    assert.equal(await evaluate(`document.getElementById('fmt-block').value`), 'h2', 'the menu shows it');

    step('Bulleted list');
    await caret('Second paragraph', 1);
    await button('ul');
    await waitFor(`${S}.querySelector('article ul li h2')`, 2000, 'a list item');

    step('Ctrl+K: the URL field makes a link');
    await select('world');
    await press.link();
    await waitFor(`!document.getElementById('fmt-link').hidden && document.activeElement.id === 'fmt-url'`, 2000, 'the URL field');
    await send('Input.insertText', { text: 'other.md#top' });
    await press.enter();
    await waitFor(`${S}.querySelector('article a[href="other.md#top"]')`, 2000, 'the new link');
    assert.equal(await art(`art.querySelector('a[href="other.md#top"]').textContent`), 'world');
    assert.equal(await evaluate(`document.getElementById('fmt-link').hidden`), true, 'the field closes');

    step('the field shows the address of a link to change it');
    await select('docs');
    await button('link');
    assert.equal(await evaluate(`document.getElementById('fmt-url').value`), 'https://example.com');
    assert.equal(await evaluate(`document.getElementById('fmt-unlink').hidden`), false);
    await evaluate(`document.getElementById('fmt-unlink').click()`);
    await waitFor(`!${S}.querySelector('article a[href="https://example.com"]')`, 2000, 'unlinked');

    step('a plain click on a link does not follow it while formatting');
    const followed = await art(`(() => {
      const a = art.querySelector('a[href="other.md#top"]');
      const e = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
      a.dispatchEvent(e);
      return document.getElementById('bar-name').textContent;
    })()`);
    assert.equal(followed, '• notes.md', 'still here');

    step('Ctrl+S saves the formatted source in place, CRLF kept');
    await press.save();
    await toastSays('Saved notes.md');
    const saved = Buffer.from(await evaluate(`window.__files.read('notes.md')`)).toString('utf8');
    assert.equal(saved, '# Notes\r\n\r\nHello ***brave** [world](other.md#top)*.\r\n\r\n- ## Second paragraph here.\r\n\r\nSee the docs now.\r\n');

    step('Edit mode: the same keys act on the textarea, and Ctrl+Z undoes natively');
    await press.e();
    await waitFor(`${S}.querySelector('textarea')`, 2000, 'the editor');
    const ta = `${S}.querySelector('textarea')`;
    assert.equal(await evaluate(`${ta}.value.split('\\n')[2]`), 'Hello ***brave** [world](other.md#top)*.', 'the editor has the toolbar\'s text');
    await evaluate(`(() => { const t = ${ta}; t.focus(); const at = t.value.indexOf('See'); t.setSelectionRange(at, at + 3); })()`);
    await press.bold();
    assert.ok(await evaluate(`${ta}.value.includes('**See** the docs')`), 'bold in the source');
    assert.equal(await evaluate(`(() => { const t = ${ta}; return t.value.slice(t.selectionStart, t.selectionEnd); })()`), 'See');
    await press.undo();
    assert.ok(await evaluate(`${ta}.value.includes('\\nSee the docs')`), 'native undo');
    await evaluate(`(() => { const t = ${ta}; const at = t.value.indexOf('# Notes') + 3; t.setSelectionRange(at, at); })()`);
    await button('quote');
    assert.ok(await evaluate(`${ta}.value.startsWith('> # Notes')`), 'block types too');

    step('t hides the toolbar again: plain rendering');
    await press.esc();
    await waitFor(`${S}.querySelector('article blockquote')`, 2000, 'read mode');
    await press.t();
    await waitFor(`document.getElementById('format').hidden`, 2000, 'hidden');
    assert.equal(await art(`art.querySelectorAll('[data-s]').length`), 0);

    assert.deepEqual(b.problems, [], 'page errors');
  } finally {
    await b.close();
    await stop(server).catch(() => {});
  }
  console.log('ok: formatting toolbar');
}

main().catch((e) => { console.error(e); process.exit(1); });
