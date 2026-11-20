# md-whatever

**Yes, it's another Markdown reader.**

Nobody needed one. There are already dozens: editors with a preview pane,
browser extensions, Electron apps that bring a whole web browser along to show
you a README, and document viewers that technically open `.md` files the way a
toaster technically heats a room. None of them did quite this:

- open a Markdown file **instantly** when you double-click it,
- make it look **good**, in your desktop's colors and fonts or in a theme you
  wrote yourself in plain CSS,
- render **math** properly,
- and otherwise **leave you alone**: no editing, no accounts, no web engine,
  no network.

So here it is. It's small, it's for Linux, and it does one thing. Try it,
or don't. Whatever.

```
mdw notes.md
```

Not on Linux? The same engine and themes also run in a browser tab:
**[md.wtvr.sh](https://md.wtvr.sh/)**. See
[The web reader](#the-web-reader).

---

## What it does

### Opens files and gets out of the way

- A window shows the rendered text in about **0.15 seconds** on a normal
  laptop. It's a native Qt app, not a browser in disguise.
- **Double-click a `.md` file** in your file manager and it opens here (the
  installer offers to set that up).
- **One window per file.** Open several at once with `mdw a.md b.md`,
  or read from a pipe: `curl -s … | mdw -`.
- **Live reload.** Save the file in your editor and the window updates on its
  own, keeping your place, even with editors that save by replacing the file.
- **`e` opens the file in your editor**, the one your desktop uses for text
  files (or any you choose), so fixing a typo is one keypress away.
- **Links work:** links to other `.md` files open in the same window (with
  back/forward), `#section` links scroll, web links open in your browser,
  and links to other local files open in their usual app.
- **Remembers** your window size and zoom level.

### Understands the Markdown you actually write

CommonMark plus the GitHub-flavored bits people use every day:

- headings, emphasis, lists, block quotes, code, horizontal rules, images
- **tables** (with column alignment)
- **task lists** (`- [x] done`), drawn as checkboxes
- ~~strikethrough~~
- **footnotes**, with links back to where they're used
- bare URLs and email addresses turned into links
- **YAML front matter** (`---` … `---` at the top) is hidden instead of being
  shown as a jumble of text
- **code blocks with syntax highlighting** for hundreds of languages, using
  the same engine as Kate and KWrite

Long URLs and paths wrap instead of running off the edge. Files that aren't
UTF-8 still open (as Latin-1, with a note at the top saying so).

### Renders math

`$inline$` and `$$display$$` math, plus ```` ```math ```` blocks, are typeset by
[MathJax](https://www.mathjax.org/), so fractions, matrices, `cases`, `align`,
`\mathbb{R}`, `\mathfrak{g}` and friends look like they do in a paper.

- The text appears first; equations fill in a moment later. They're cached, so
  the next time you open the file they're instant.
- Dollar amounts are left alone: `$5 and $10` is money, not math.
- A broken equation shows its TeX source in red instead of taking the page down.

### Looks however you want

Everything about how a document looks is a CSS file, and it **reloads live**
while you edit it.

- The **default theme** follows your desktop: its colors, accent color, fonts,
  and light/dark mode (it switches the moment your desktop does).
- **Right-click → Theme** to switch themes, or to force **Light** or **Dark**
  regardless of your desktop. Handy for reading in a light theme on a dark
  desktop.
- Comes with `default` and `paper` built in, plus four examples to copy:
  `github`, `catppuccin`, `terminal` (all monospace) and `book` (printed-book
  typography).
- Small tweaks go in one file (`user.css`); whole themes go in a folder. See
  [Themes](#themes).

### Reading comforts

Find in page, keyboard scrolling (including `j`/`k` for vim people), zoom,
copy, and a right-click menu. [Keys](#keys) has the full list.

---

## What it doesn't do

Some of these are on purpose, some are just "not yet". Knowing which is which
saves you some time.

**On purpose. These aren't coming:**

- **Editing.** It's a reader. Press `e` to open the file in your own editor;
  md-whatever reloads when you save. (The [web reader](#the-web-reader) can
  edit, since a browser tab has no editor next to it.)
- **A web engine or JavaScript.** That's the whole point. Pages are drawn by
  [litehtml](https://github.com/litehtml/litehtml), a small HTML/CSS renderer.
- **Network access.** It never fetches anything. **Images from the web aren't
  shown**, and neither are images embedded directly in the file (`data:`
  URLs). Only image files on your disk are loaded.
- **Raw HTML in Markdown.** `<b>`, `<div>`, `<details>` and friends are shown as
  literal text, not rendered. Safer, and simpler.
- **Mermaid diagrams, charts and other "render this code block as a picture"
  extensions.** They'd need JavaScript.
- **A Windows or macOS app.** It's a Linux app. On other systems, use the
  [web reader](#the-web-reader).

**Not supported (at least for now):**

- **Printing or exporting to PDF.**
- **GitHub "alert" boxes** (`> [!NOTE]`). They show as a normal quote.
- **Emoji shortcodes** (`:smile:`). Actual emoji characters (🎉) display fine
  if you have an emoji font.
- **Other Markdown extensions:** `==highlight==`, `H~2~O` / `x^2^`,
  definition lists, `[[wiki links]]`, tables of contents, `\(…\)` / `\[…\]` math
  (use `$…$` and `$$…$$`).
- **Tabs, a sidebar, a file browser** or searching across files. (The web
  reader has a sidebar.)
- **Wide tables** can't scroll on their own; a table wider than the text column
  makes the whole page scroll sideways.
- **Broken images** show nothing (not even their alt text).
- **Huge files** are fine but not instant: a 450 KB, 5,000-line file takes
  about a second.

**Things that depend on your system:**

- Chinese, Japanese and Korean text needs a CJK font (e.g. `noto-fonts-cjk`),
  otherwise you'll see boxes.
- If your desktop font has no **bold** style, bold text looks regular in the
  default theme. Pick a different reading font (see [Themes](#themes)) or use
  any of the other themes.
- Developed on Arch Linux with KDE Plasma (Wayland). Other desktops should
  work, since it's an ordinary Qt app, but they're less tested. Outside KDE, the
  default theme's colors come from whatever Qt theme your desktop provides.

---

## Install

**On macOS, Windows or another system:** there's nothing to install. Open
[md.wtvr.sh](https://md.wtvr.sh/), and see
[The web reader](#the-web-reader) for making it an app.

On **Arch Linux** or anything based on it (EndeavourOS, Manjaro, …):

1. Get the code: download it as a ZIP and unpack it, or `git clone` it.
2. Open a terminal in that folder and run:

   ```bash
   ./install.sh
   ```

The script:

1. checks for the packages md-whatever needs and offers to install any that
   are missing (this is the only step that asks for your password);
2. builds md-whatever, which takes about half a minute;
3. installs it into your home folder (`~/.local`), so nothing system-wide is
   touched, as the command `mdw` (or `md-whatever`);
4. asks whether `.md` files should open with md-whatever from now on, and
   remembers what they opened with before.

Run it again any time to update after getting newer code. To remove it:

```bash
./install.sh --uninstall
```

That removes the app and puts your previous Markdown app back. Your settings
(`~/.config/md-whatever`) are kept in case you come back; delete that folder
too if you want it all gone.

**Other distributions:** install the equivalents of the Arch packages listed
at the top of `install.sh` first, then run the same script. You need Qt 6.5 or
newer, litehtml 0.10, KDE Frameworks 6 syntax-highlighting, md4c and CMake, plus
Node.js and MathJax 4 for math. Without Node.js and MathJax everything else
works and equations show as TeX source. Some distributions don't package
litehtml or a new enough Qt yet, so this may not be smooth everywhere.

---

## Using it

The command is `mdw` (short for `md-whatever`, which works too).

```
mdw FILE [FILE...]     open each file in its own window (paths or file:// URLs)
mdw -                  read Markdown from stdin
mdw --theme NAME FILE  use a theme just this once
mdw --dump-html FILE   print the rendered HTML (after math) and exit
mdw --time FILE        print startup timings
mdw --version
```

Want to see everything it can render? Open
[`tests/fixtures/kitchen-sink.md`](tests/fixtures/kitchen-sink.md) and
[`tests/fixtures/math.md`](tests/fixtures/math.md).

### Keys

| Key | Action |
|---|---|
| `j` / `k`, arrows | scroll a line |
| `Space` / `Shift+Space`, `PgDn` / `PgUp` | scroll a page |
| `g` / `G`, `Home` / `End` | top / bottom |
| `/` or `Ctrl+F` | find (`Enter` / `Shift+Enter`: next / previous) |
| `n` / `N`, `F3` / `Shift+F3` | next / previous match |
| `Alt+Left` / `Alt+Right` | back / forward (after following a link) |
| `r` / `F5` | reload |
| `e` | open the file in your editor ([Editing](#editing)) |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | zoom in / out / reset |
| `Ctrl+C` | copy the selection |
| `q` / `Ctrl+W` / `Esc` | close (`Esc` closes the find bar first) |

### Right-click menu

Edit · Reload · Copy · Find · **Theme** (pick a theme; Follow System / Light / Dark;
Open Themes Folder) · Open Containing Folder.

### Editing

`e` (or right-click → **Edit**) opens the file you're reading in a text
editor, and every save shows up in the window, keeping your place. After you
follow a link, it's the linked file that opens. On a "File not found" page,
the editor creates the file. md-whatever starts the editor and leaves it alone:
close either one whenever you like.

Which editor: the `editor=` line in `md-whatever.conf` if there is one,
otherwise your desktop's default app for plain text files (Kate on KDE).
`{file}` stands for the file; without it, the file goes at the end.

```ini
editor=kate
editor=code -g {file}
editor=konsole -e nvim {file}
```

Terminal editors (vim, nano, …) need a terminal to run in, as in the last line.
If no editor can be found or started, a note at the bottom of the window says
why.

### Where things live

| Path | What |
|---|---|
| `~/.config/md-whatever/md-whatever.conf` | settings: `theme=`, `appearance=`, `code-theme=`, `editor=` |
| `~/.config/md-whatever/user.css` | your tweaks, applied on top of any theme |
| `~/.config/md-whatever/themes/*.css` | your themes |
| `~/.config/md-whatever/state.conf` | remembered window size and zoom |
| `~/.cache/md-whatever/math` | rendered equations (safe to delete) |
| `~/.local/bin/md-whatever` | the program, and `mdw`, a link to it |

The settings file is optional; md-whatever writes the `theme=` and `appearance=`
lines itself when you use the menu, and leaves the rest of the file alone.

---

## The web reader

The same Markdown engine, compiled to WebAssembly, in a single HTML page,
styled by the same theme files. It's for macOS, Windows, or anywhere else the
desktop app doesn't run. Two ways to get it:

- **Hosted:** [md.wtvr.sh](https://md.wtvr.sh/).
  You can install it as an app, and it then works offline. (It used to live at
  pywkt.github.io/md-whatever, which now sends you here. Recent files and
  settings stay with the old address, so an app installed from there needs
  installing again.)
- **One file:** `md-whatever.html`, attached to each tagged
  [release](https://github.com/pywkt/md-whatever/releases), or built by you (see
  [Building by hand](#building-by-hand)). Save it anywhere and open it in a
  browser. It needs no server and no install.

What you get:

- **Many files in one tab.** Every open file gets a row in the sidebar. Open
  files or a whole folder with the buttons or `o`, drop them onto the page,
  paste Markdown text, or start a new file with **New file** or `n`. When you
  open a folder, relative images and links between its files work.
- **Everything the app renders:** tables, task lists, footnotes, front matter,
  math (MathJax, with the app's settings), and every theme in light and dark,
  picked in the sidebar.
- **Editing** the Markdown source, with saving back to the file in browsers
  that allow it, and a **formatting toolbar** for bold, links, headings,
  lists and so on, right in the rendered page. See
  [Editing in the browser](#editing-in-the-browser).
- **Live reload**, and **Recent** files in the sidebar, in the browsers that
  allow it (below).
- **Sharing** a file as a link, encrypted so only people with the link can read
  it (hosted version). See [Sharing a file](#sharing-a-file).

What works depends on the browser, because browsers differ in what they let a
page do with your files:

| | Chrome, Edge, Brave | Arc | Safari | Firefox |
|---|---|---|---|---|
| Read files, folders, themes, math | yes | yes | yes | yes |
| **Save** (`⌘S` / `Ctrl+S`) | to the original file | to the original file | downloads a copy | downloads a copy |
| Save as a new file (`⌘⇧S` / `Ctrl+Shift+S`) | yes | yes | downloads a copy | downloads a copy |
| Live reload | yes | yes | no: open the file again | no: open the file again |
| Recent files | yes | yes | no | no |
| Install as an app | install button in the address bar | no | **File → Add to Dock** (macOS Sonoma or later) | no |
| Open `.md` files from Finder / Explorer | yes, once installed (**Open With**) | no | no: drop files on the window | no |

**On a Mac,** the most app-like setup is Chrome, Edge or Brave: open the hosted
page, click the install button at the right of the address bar, and Markdown
files then offer md-whatever under **Open With** in Finder. To make it the
default, use **Get Info → Open with → Change All**. In Safari, **File → Add to
Dock** gives you an app window, but Safari apps can't be picked in Open With, so
drop files onto the window instead.

### Editing in the browser

Press **Edit** in the top bar, or `e`, and the document turns into its Markdown
source, in the theme's monospace font and colors. **Read** or `Esc` shows the
rendered result of your changes. Every open file keeps its own mode, changes and
undo history while you switch between files. `Tab` inserts two spaces;
`Shift+Tab` moves the keyboard focus out of the editor.

- **Unsaved changes** show as a dot before the file's name in the sidebar, the
  top bar and the browser tab, and a **Save** button appears. Closing that file,
  or the whole tab, asks first.
- **Saving** (`⌘S` / `Ctrl+S`) writes to the file you opened in Chrome, Edge,
  Brave and Arc. The first save of each file asks for permission to write to
  it. `⌘⇧S` / `Ctrl+Shift+S` saves to a new file instead, which the document
  then refers to.
- **A new file** (**New file** in the sidebar, or `n`) opens empty, in Edit
  mode. Its first save asks where to put it, suggesting a name made from its
  first heading, and from then on it's that file. In Safari and Firefox, Save
  downloads it under that name. A new file you didn't type in closes without
  asking.
- **Safari and Firefox** don't let a page write to your files, so there **Save**
  becomes **Download** and saves a copy to your downloads folder; the original
  file stays as it was. The first time you edit a file there, a note says so.
- **Your file stays your file.** Saving keeps its line endings (LF or CRLF), its
  encoding (UTF-8, or Latin-1 for older files) and its byte order mark, so
  saving a file you didn't change gives back exactly the same bytes. If you type
  a character a Latin-1 file can't hold, md-whatever asks before switching the
  file to UTF-8.
- **If the file changes on disk** (say, in another editor) while you have
  unsaved changes, a bar offers **Reload from disk** or **Keep my edits**, and a
  later save asks before overwriting the newer file. Without unsaved changes, the
  editor just picks up the new version.
- **Samples** (the welcome page and the bundled documents) can be edited as
  scratch space. Saving one creates a new file.

There's no autosave: unsaved changes live only in the open tab.

**Formatting toolbar.** The **A** button next to **Edit** (or `t`) shows a
toolbar under the top bar, so you can format a document while reading it:
select some text (or click into a paragraph) and use a button.

- **Inline:** bold, italic, strikethrough, code and links (`⌘B` / `Ctrl+B`,
  `⌘I` / `Ctrl+I`, `⌘K` / `Ctrl+K`). Pressing one on text that already has it
  takes it away. A link gets its address from a small field in the toolbar,
  which also changes or removes an existing link.
- **Blocks:** paragraph or heading 1-6 (the menu shows what the cursor is
  in), bulleted, numbered and task lists, quote, code block, and a horizontal
  rule.
- Every change is a small edit to the Markdown itself: the toolbar adds or
  removes the markers and leaves the rest of the file exactly as you wrote it
  (`*` or `_`, line breaks, list markers). The result counts as unsaved
  changes like any other edit.
- `⌘Z` / `Ctrl+Z` undoes (`⌘⇧Z` / `Ctrl+Shift+Z` redoes), also with the
  buttons at the end of the toolbar.
- While the toolbar is shown, a click on a link puts the cursor in it instead
  of following it. `⌘`-click / `Ctrl`-click follows it.
- The toolbar works on the source in Edit mode too, as one undoable step each.
  After formatting in the rendered page, the source editor's own undo history
  starts again.

### Sharing a file

On [md.wtvr.sh](https://md.wtvr.sh/), the share button in the top bar makes a
link to the open file, like `https://md.wtvr.sh/are/k3J9x2Hq7v#Tb8kQ2vX9mLpR4sN7wYc1A`.
Pick how long it works (1 day, 7 days or 30 days), press **Create link**, and
send it to anyone. Opening it shows the file in the reader, where they can read
it, edit it and save their own copy.

- **It's encrypted in your browser** before it's uploaded. The key is the part
  of the link after the `#`, which browsers never send to a server, so the copy
  stored on md.wtvr.sh can't be read without the link, not even by md.wtvr.sh.
  Whoever has the link can read the file, so share it like you'd share the file.
- **A link is a snapshot** of the file as it was when you made it, including
  unsaved changes. Change the file later and the share panel says so and offers
  a new link.
- **Stop sharing** deletes the copy straight away. Only the browser that made
  the link can do that. Otherwise it's deleted when it expires.
- Only the Markdown text is shared, up to 1 MB compressed (several MB of text).
  Images and links to other files in its folder don't come along.
- The single-file `md-whatever.html` has no share button: it never touches the
  network.

Keys are the app's (`j`/`k`, `Space`, `g`/`G`, `r`) plus `[` / `]` for the
previous / next open file, `+` / `-` / `0` for zoom, `o` to open files, `n`
for a new file, `e` / `Esc` to edit / read, `t` for the formatting toolbar, and
`⌘S` / `Ctrl+S` to save.

**What it sends over the network.** Your files never leave your computer. They
are read and rendered inside the page and uploaded nowhere, unless you
[share one](#sharing-a-file): then an encrypted copy of that one file goes to
md.wtvr.sh. The page does fetch some things:

- the hosted page itself, from md.wtvr.sh (on Cloudflare);
- a shared file, encrypted, when you open a share link;
- [highlight.js](https://highlightjs.org/) (code colors) from cdnjs and MathJax
  (math) from jsDelivr, only when a document has code or math. The hosted
  page keeps them for offline use once fetched. Without them, code is plain and math
  shows as TeX source, as in the app without MathJax;
- images from the web, only if you turn on **Load images from the web** in the
  sidebar. They're off by default.

Your settings (theme, appearance, zoom, sidebar width) and the Recent list are kept in your
browser's storage for this page, nowhere else.

**How it differs from the app:** code colors come from highlight.js with Breeze
colors, because KDE's syntax-highlighting library needs Qt. Raw HTML stays
literal text, as in the app. Browsers that block WebAssembly get a plain
JavaScript translation of the same engine, which renders identically but more
slowly.

---

## Themes

Everything about how documents look is CSS. Files reload live when you save
them, so keep a document open while you tweak.

- **Small tweaks:** `~/.config/md-whatever/user.css`, loaded after the theme.
  [`examples/user.css.example`](examples/user.css.example) has commented ideas
  to copy from.
- **Pick a theme:** right-click → Theme. That restyles every open window and
  remembers the choice. Or put `theme=paper` in `md-whatever.conf` yourself,
  or use `--theme paper` for a single run. Built in: `default` (follows your
  desktop's colors and fonts) and `paper` (warm serif).
- **Light or dark:** right-click → Theme → Follow System / Light / Dark (saved
  as `appearance=`). Every theme has both versions. Forcing the opposite of your
  desktop uses Breeze Light/Dark colors, keeping your accent color.
- **Example themes** in [`examples/themes/`](examples/themes/): `github`,
  `catppuccin` (Latte/Mocha, pink accent), `terminal` (all monospace) and
  `book` (Charter, indented paragraphs). Copy them into
  `~/.config/md-whatever/themes/` and they show up in the menu.
- **Your own theme:** `~/.config/md-whatever/themes/NAME.css`. Start from a copy
  of [`src/themes/default.css`](src/themes/default.css) or an example. A theme
  with the same name as a built-in one replaces it.
- **Code colors:** `code-theme=Solarized Dark` in `md-whatever.conf` (any
  syntax-highlighting theme name, as in Kate's settings). Each example theme
  names a matching one at the top of its file. Default: Breeze Light/Dark.

Themes use these variables, filled in from your desktop's palette and fonts.
Override any of them in `:root`, or in `html.dark` / `html.light` for just one
mode:

| Variable | Default from |
|---|---|
| `--bg`, `--text` | palette Base / Text |
| `--muted`, `--faint` | text mixed toward the background |
| `--rule` | lines: headings, tables, rules |
| `--code-bg`, `--code-border` | code blocks and inline code |
| `--quote-bg`, `--table-head`, `--table-stripe` | block quote, table header, zebra rows |
| `--link`, `--accent`, `--accent-text` | palette Link / Highlight (your accent color) |
| `--error` | math errors |
| `--body-font`, `--mono-font` | system font / fixed-width font |
| `--base-size` | body text size (UI font size × 1.2) |
| `--clear` | transparent (see the quirk below) |

Example `user.css`:

```css
:root {
  --body-font: "Noto Sans";   /* a proportional font for reading */
  --base-size: 17px;
}
html.dark { --bg: #1b1b1f; }
h1, h2 { border-bottom: 0 solid var(--rule); }   /* no heading underlines; see the quirk below */
.markdown-body { max-width: 52em; }               /* wider text column */
```

Useful selectors: `.markdown-body` (the text column), `pre.code`, `code`,
`blockquote`, `table` / `th` / `td`, `.task` / `.task.checked` (task boxes),
`.footnotes`, `.math-display`, `img.math`, `.math-error`, `.banner`.

**What CSS works:** CSS 2.1 plus some CSS 3: `var()`, `border-radius`,
`max-width`, `:nth-child`, `::before` / `::after` content, `text-indent`. Not
supported: flexbox/grid, `text-transform`, `letter-spacing`, small caps,
shadows, `vertical-align` lengths, `word-break`. Use `em` rather than `ch` for
widths.

**One quirk to know:** a value that uses `var()` beats any plain value, whatever
the selector or order. So if a theme sets `border-bottom: 1px solid var(--rule)`,
`border-bottom: 0` won't remove it; write `border-bottom: 0 solid var(--rule)`.
For backgrounds, `background: var(--clear)` is transparent.

---

## Math details

Math is rendered by MathJax 4 running under your system's Node.js. md-whatever
starts it only when a document has math, and it reads only local files. The
TeX input supports the standard macros plus AMS (`align`, `cases`, `pmatrix`,
`\mathbb`, …). The math fonts MathJax needs for script, fraktur,
double-struck and other alphabets are downloaded once, when you build, from the
npm registry (hash-checked). That's the only time anything touches the network.

If equations show as source code instead of math, Node.js or MathJax isn't
installed (`sudo pacman -S nodejs mathjax` on Arch).

---

## Building by hand

For hacking on it. Needs (Arch): `qt6-base qt6-svg litehtml md4c
syntax-highlighting cmake ninja`, plus `nodejs mathjax` for math. The web
reader also needs `clang lld wasi-libc wasi-libc++ wasi-libc++abi
wasi-compiler-rt binaryen python`, and `chromium` for its browser tests.

```bash
cmake -S . -B build -G Ninja -DCMAKE_INSTALL_PREFIX=$HOME/.local
cmake --build build
(cd build && ctest)                          # tests (offscreen; no windows pop up)
cmake --install build                        # ~/.local/bin/md-whatever (+ mdw) + data + .desktop
cmake --build build --target set-default     # make md-whatever open .md files
```

Undo: `cmake --build build --target restore-default` puts Okular back as the
default; `cmake --build build --target uninstall` removes the installed files.

The web reader is built along with the app whenever its tools are installed,
into `build/web/md-whatever.html` (the single-file page) and `build/web/site/`
(the hosted version: the page plus a manifest, service worker and icons).
`-DMDW_WEB_READER=OFF` skips it, `ON` makes missing tools an error, and
`-DMDW_DESKTOP=OFF` builds only the web reader, without Qt. Its browser tests
run in headless Chromium with the network blocked, and are skipped if Chromium
isn't found (`MDW_CHROMIUM=/path/to/chromium` points them at one). To try the
hosted version locally, run `npm install` once in `share/`, then `npm run dev`
there: [Wrangler](https://developers.cloudflare.com/workers/wrangler/) serves
the site folder with sharing (a local stand-in for its storage) at
`http://127.0.0.1:8787`. `share/` is the Cloudflare Worker behind md.wtvr.sh:
it serves `build/web/site` and stores shared files. The built page is published,
never committed: [`.github/workflows/web.yml`](.github/workflows/web.yml)
deploys the Worker and the site from `main` and attaches the single file to
releases.

Layout: `src/markdown.cpp` turns Markdown into HTML (plain C++, no Qt),
`src/document.cpp` assembles the page, `src/math.cpp` talks to the MathJax
helper (`data/mathjax-helper.cjs`), `src/theme.cpp` handles themes and
settings, `src/editor.cpp` finds the editor for `e`, and `src/mainwindow.cpp` is
the window. `third_party/qlitehtml` is a
vendored copy of the Qt widget for litehtml, with a few local fixes listed in
its `UPSTREAM_COMMIT`. `web/` is the web reader: `engine.cpp` wraps
`src/markdown.cpp` for WebAssembly, `reader.js` and `lib.js` are the page, and
`build.py` assembles it all into one file. Its tests are in `tests/web/`.

Developer aids (environment variables):

- `MDW_SCREENSHOT=out.png`: save a screenshot once text and math have rendered,
  then quit. `MDW_SCREENSHOT_SCROLL=0.5` scrolls halfway first. Works headless
  with `QT_QPA_PLATFORM=offscreen`.
- `MDW_QUIT_AFTER_PAINT=1`: quit after the first paint (pair with `--time`).
- `MDW_DATA_DIR`: where to find `mathjax-helper.cjs` and the math fonts.
- `QT_FORCE_STDERR_LOGGING=1`: print Qt warnings to the terminal instead of the
  system journal.

---

## Credits

md-whatever is mostly glue. The hard parts are other people's work:
[litehtml](https://github.com/litehtml/litehtml) and
[qlitehtml](https://code.qt.io/playground/qlitehtml.git) draw the page,
[md4c](https://github.com/mity/md4c) parses the Markdown,
[KSyntaxHighlighting](https://invent.kde.org/frameworks/syntax-highlighting)
colors the code, [MathJax](https://www.mathjax.org/) and the New Computer
Modern fonts typeset the math, and [Qt](https://www.qt.io/) does everything
else. In the web reader, [highlight.js](https://highlightjs.org/) colors the
code, and [wasi-libc](https://github.com/WebAssembly/wasi-libc) and LLVM's
libc++ are compiled into the engine.

## License

md-whatever's own code is MIT (see [`LICENSE`](LICENSE)). Do whatever.

One catch: the Qt widget in [`third_party/qlitehtml`](third_party/qlitehtml)
is someone else's code under GPL-3.0 (with the Qt exception; license texts in
its `LICENSES` folder). Since it's compiled in, a built md-whatever is covered
by GPL-3.0 as a whole. In practice: use it and change it freely; if you hand
out a built copy, the GPL's "share the source" terms apply. The other libraries
are permissive: litehtml (BSD-3-Clause), md4c (MIT), KSyntaxHighlighting
(MIT), MathJax and its fonts (Apache-2.0).

The web reader doesn't contain qlitehtml, so the GPL doesn't apply to it: it's
md-whatever and md4c (MIT), with parts of wasi-libc (MIT) and libc++ (Apache-2.0
with the LLVM exception) linked in. highlight.js (BSD-3-Clause) and MathJax
(Apache-2.0) are loaded from a CDN, not bundled.
