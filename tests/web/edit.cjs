// Editing in the web reader, in headless Chromium (the browser that can save in
// place), with the page served from 127.0.0.1:
//   - e / Esc / the Edit button switch modes; the draft is what Read renders
//   - unsaved changes show a dot (sidebar, bar, tab title) and survive switching
//     files; an edited sample is not dropped when a real file opens
//   - Cmd/Ctrl+S writes the file in place, keeping its BOM, line endings and
//     encoding; live reload does not take that save for an outside change
//   - an outside change replaces a clean editor, but never unsaved changes: the
//     conflict bar offers both ways, and saving then asks first
//   - a Latin-1 file stays Latin-1, and asks before becoming UTF-8
//   - Save As of an untouched file gives back the same bytes
//   - Safari and Firefox (no save picker): Save downloads a copy
//   - closing a file or the page with unsaved changes asks first
//
//   node tests/web/edit.cjs PAGE.html
//
// Files are real file handles from the page's private file system
// (navigator.storage), handed over the way an installed app gets them from
// Finder. Chromium: see cdp.cjs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launch, serve, stop, sleep, PAGE_WAIT } = require('./cdp.cjs');

const pageArg = process.argv[2];
if (!pageArg) {
  console.error('usage: edit.cjs PAGE.html');
  process.exit(2);
}
const fixture = (name) => [...fs.readFileSync(path.join(__dirname, '..', 'fixtures', name))];
const utf8 = (s) => [...Buffer.from(s, 'utf8')];
const BOM = [0xef, 0xbb, 0xbf];

async function main() {
  const page = fs.realpathSync(pageArg);
  const server = await serve(path.dirname(page));
  const url = `http://127.0.0.1:${server.address().port}/${path.basename(page)}`;
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'mdw-dl-'));
  const b = await launch({ offline: true });
  const step = (what) => console.log('- ' + what);
  try {
    const { send, evaluate } = b;
    const waitFor = (expr, ms = 5000, what = expr) => evaluate(`(async () => { ${PAGE_WAIT}
      return await wait(async () => ${expr}, ${ms}); })()`).then((v) => { assert.ok(v, 'timed out waiting for ' + what); return v; });

    // confirm() and friends: answered with the next queued answer (default yes)
    const dialogs = [];
    const answers = [];
    b.on('Page.javascriptDialogOpening', (p) => {
      dialogs.push(p.message);
      send('Page.handleJavaScriptDialog', { accept: answers.length ? answers.shift() : true });
    });
    const takeDialogs = () => dialogs.splice(0);

    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn) { window.__launch = fn; } } });
      // Save As: the picker can't be driven headless; it "picks" saved-as.md
      window.showSaveFilePicker = async (opts) => {
        window.__pickerOpts = opts;
        return (await navigator.storage.getDirectory()).getFileHandle('saved-as.md', { create: true });
      };
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
      };` });
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await b.load(url);
    await waitFor(`document.getElementById('viewer').shadowRoot.querySelector('article h1')`);

    const S = `document.getElementById('viewer').shadowRoot`;
    const state = () => evaluate(`(() => {
      const root = ${S};
      const ta = root.querySelector('textarea');
      const art = root.querySelector('article');
      const shown = (id) => !document.getElementById(id).hidden;
      return {
        bar: document.getElementById('bar-name').textContent,
        title: document.title,
        rail: [...document.querySelectorAll('#file-list .file-name')].map((n) => n.textContent),
        mode: document.getElementById('mode').textContent,
        save: shown('save') ? document.getElementById('save').textContent : null,
        conflict: shown('conflict') ? document.getElementById('conflict-text').textContent : null,
        editor: ta ? ta.value : null,
        editorFocused: !!ta && root.activeElement === ta,
        h1: art && art.querySelector('h1') ? art.querySelector('h1').textContent : null,
        banner: !!(art && art.querySelector('.banner')),
      };
    })()`);
    const key = async (keyName, code, vk, modifiers = 0) => {
      const k = { key: keyName, code, windowsVirtualKeyCode: vk, modifiers };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    };
    // A toast stays up for seconds; clear it so the next "Saved" is the next save's.
    const clearToast = () => evaluate(`(() => { const t = document.getElementById('toast'); t.hidden = true; t.textContent = ''; })()`);
    const press = {
      e: () => key('e', 'KeyE', 69),
      esc: () => key('Escape', 'Escape', 27),
      tab: () => key('Tab', 'Tab', 9),
      save: () => clearToast().then(() => key('s', 'KeyS', 83, 2)), // Ctrl+S
      saveAs: () => clearToast().then(() => key('S', 'KeyS', 83, 2 | 8)), // Ctrl+Shift+S
    };
    const caret = (where) => evaluate(`(() => { const ta = ${S}.querySelector('textarea'); ta.focus();
      const at = ${where === 'end' ? 'ta.value.length' : where}; ta.setSelectionRange(at, at); })()`);
    const type = (text) => send('Input.insertText', { text });
    const read = (name) => evaluate(`window.__files.read(${JSON.stringify(name)})`);
    const toastSays = (text) => waitFor(`!document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes(${JSON.stringify(text)})`,
      5000, `the toast "${text}"`);

    step('e edits the welcome sample; an edited sample stays when a file opens');
    await press.e();
    let s = await state();
    assert.equal(s.mode, 'Read');
    assert.ok(s.editor.startsWith('# md-whatever, in a browser tab\n'), 'the editor holds the source');
    assert.ok(s.editorFocused, 'the editor has the focus');
    assert.equal(s.save, null, 'no Save button before a change');
    await caret(0);
    await type('Hello ');
    await waitFor(`document.title.startsWith('• ')`, 2000, 'the unsaved dot');
    s = await state();
    assert.equal(s.bar, '• welcome.md');
    assert.equal(s.save, 'Save as…', 'a sample saves to a picked file');
    await evaluate(`window.__files.launch('crlf-bom.md', ${JSON.stringify([...BOM, ...utf8('# Title\r\n\r\nfirst line\r\n')])})`);
    await waitFor(`document.getElementById('bar-name').textContent === 'crlf-bom.md'`);
    s = await state();
    assert.deepEqual(s.rail, ['• welcome.md', 'crlf-bom.md']);
    assert.equal(s.mode, 'Edit', 'a newly opened file is shown for reading');
    assert.equal(s.h1, 'Title');

    step('typing, Tab, and Ctrl+S save in place with the BOM and CRLF kept');
    await press.e();
    s = await state();
    assert.equal(s.editor, '# Title\n\nfirst line\n', 'the editor has LF line endings');
    await caret('end');
    await type('more');
    await press.tab();
    await waitFor(`document.getElementById('bar-name').textContent === '• crlf-bom.md'`, 2000, 'dirty');
    s = await state();
    assert.equal(s.editor, '# Title\n\nfirst line\nmore  ', 'Tab inserts two spaces');
    assert.equal(s.save, 'Save');
    await evaluate(`${S}.querySelector('textarea').__mark = 1`);
    await press.save();
    await toastSays('Saved crlf-bom.md');
    assert.deepEqual(await read('crlf-bom.md'), [...BOM, ...utf8('# Title\r\n\r\nfirst line\r\nmore  ')]);
    s = await state();
    assert.equal(s.bar, 'crlf-bom.md');
    assert.equal(s.save, null);
    await sleep(1500); // live reload looks every second: our own save is not news
    assert.equal(await evaluate(`${S}.querySelector('textarea').__mark`), 1, 'the editor was not replaced');
    assert.equal(takeDialogs().length, 0);

    step('an outside change replaces a clean editor');
    await evaluate(`window.__files.write('crlf-bom.md', ${JSON.stringify(utf8('# Changed outside\r\n'))})`);
    await waitFor(`${S}.querySelector('textarea').value === '# Changed outside\\n'`, 5000, 'live reload into the editor');
    s = await state();
    assert.equal(s.conflict, null);
    assert.ok(s.editorFocused, 'the new editor keeps the focus');

    step('but unsaved changes are never replaced: the conflict bar, then save asks');
    await caret('end');
    await type('tail');
    await waitFor(`document.title.startsWith('• ')`, 2000, 'dirty');
    await evaluate(`window.__files.write('crlf-bom.md', ${JSON.stringify(utf8('# Second outside\n'))})`);
    await waitFor(`!document.getElementById('conflict').hidden`, 5000, 'the conflict bar');
    s = await state();
    assert.equal(s.conflict, 'crlf-bom.md changed on disk while you were editing it.');
    assert.equal(s.editor, '# Changed outside\ntail', 'the draft is kept');
    await evaluate(`document.getElementById('conflict-keep').click()`);
    assert.equal((await state()).conflict, null);
    answers.push(false);
    await press.save();
    await sleep(300);
    assert.match(takeDialogs().join(), /changed on disk since you started editing it/);
    assert.deepEqual(await read('crlf-bom.md'), utf8('# Second outside\n'), 'declining left the file alone');
    await press.save();
    await toastSays('Saved crlf-bom.md');
    assert.equal(takeDialogs().length, 1);
    assert.deepEqual(await read('crlf-bom.md'), utf8('# Changed outside\r\ntail'), 'saved, CRLF as the file had when editing began');

    step('Esc renders the draft; e goes back to the same place');
    await press.esc();
    s = await state();
    assert.equal(s.mode, 'Edit');
    assert.equal(s.editor, null);
    assert.equal(s.h1, 'Changed outside');
    await press.e();
    assert.equal((await state()).editor, '# Changed outside\ntail');

    step('Reload from disk drops the draft');
    await caret('end');
    await type(' zzz');
    await waitFor(`document.title.startsWith('• ')`, 2000, 'dirty');
    await evaluate(`window.__files.write('crlf-bom.md', ${JSON.stringify(utf8('# Third\n'))})`);
    await waitFor(`!document.getElementById('conflict').hidden`, 5000, 'the conflict bar');
    await evaluate(`document.getElementById('conflict-reload').click()`);
    await waitFor(`${S}.querySelector('textarea').value === '# Third\\n'`, 3000, 'the file from disk');
    s = await state();
    assert.equal(s.bar, 'crlf-bom.md');
    assert.equal(s.conflict, null);

    step('closing a file or the page with unsaved changes asks first');
    await caret('end');
    await type('unsaved');
    await waitFor(`document.title.startsWith('• ')`, 2000, 'dirty');
    answers.push(false);
    await evaluate(`document.querySelector('#file-list .is-active .file-close').click()`);
    assert.match(takeDialogs().join(), /crlf-bom\.md has unsaved changes/);
    assert.deepEqual((await state()).rail, ['• welcome.md', '• crlf-bom.md'], 'still open');
    assert.equal(await evaluate(`(() => { const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e); return e.defaultPrevented; })()`), true, 'leaving the page asks');

    step('a Latin-1 file stays Latin-1, and asks before becoming UTF-8');
    await evaluate(`window.__files.launch('latin.md', ${JSON.stringify(fixture('not-utf8.md'))})`);
    await waitFor(`document.getElementById('bar-name').textContent === 'latin.md'`);
    assert.ok((await state()).banner, 'the not-UTF-8 banner');
    await press.e();
    await caret('end');
    await type('é€\n');
    await waitFor(`document.title.startsWith('• ')`, 2000, 'dirty');
    await press.save();
    await toastSays('Saved latin.md');
    assert.deepEqual(await read('latin.md'), [...fixture('not-utf8.md'), 0xe9, 0x80, 0x0a]);
    await type('→\n');
    await waitFor(`document.title.startsWith('• ')`, 2000, 'dirty');
    answers.push(false);
    await press.save();
    await sleep(300);
    assert.match(takeDialogs().join(), /saved as Latin-1, which has no "→"/);
    assert.equal((await state()).bar, '• latin.md', 'declined: still unsaved');
    await press.save();
    await toastSays('Saved latin.md');
    const latin = Buffer.from(fixture('not-utf8.md')).toString('latin1') + 'é€\n→\n';
    assert.deepEqual(await read('latin.md'), utf8(latin), 'now UTF-8');
    await press.esc();
    assert.equal((await state()).banner, false, 'the banner went with the encoding');

    step('Save As of an untouched file gives back the same bytes, and is that file from then on');
    const mixed = [...BOM, ...utf8('# Mixed\r\nline\nline\r\nno final newline')];
    await evaluate(`window.__files.launch('mixed.md', ${JSON.stringify(mixed)})`);
    await waitFor(`document.getElementById('bar-name').textContent === 'mixed.md'`);
    await press.e();
    await press.saveAs();
    await toastSays('Saved saved-as.md');
    assert.deepEqual(await read('saved-as.md'), mixed);
    assert.equal(await evaluate(`window.__pickerOpts.suggestedName`), 'mixed.md');
    s = await state();
    assert.equal(s.bar, 'saved-as.md');
    assert.ok(s.rail.includes('saved-as.md') && !s.rail.includes('mixed.md'));

    step('Safari and Firefox: Save downloads a copy');
    await evaluate(`delete window.showSaveFilePicker`);
    await evaluate(`[...document.querySelectorAll('#file-list .file-main')].find((b) => b.textContent.includes('welcome.md')).click()`);
    s = await state();
    assert.equal(s.save, 'Download');
    assert.equal(s.mode, 'Read', 'the sample was left in Edit mode');
    await clearToast();
    await evaluate(`document.getElementById('save').click()`);
    await toastSays('Downloaded welcome.md');
    const got = path.join(downloads, 'welcome.md');
    for (let i = 0; i < 50 && !fs.existsSync(got); i++) await sleep(100);
    assert.ok(fs.readFileSync(got, 'utf8').startsWith('Hello # md-whatever, in a browser tab\n'));
    assert.equal((await state()).bar, 'welcome.md', 'downloaded: no longer marked unsaved');

    assert.deepEqual(b.problems, [], 'page errors');
  } finally {
    await b.close();
    await stop(server).catch(() => {});
    fs.rmSync(downloads, { recursive: true, force: true });
  }
  console.log('ok: editing');
}

main().catch((e) => { console.error(e); process.exit(1); });
