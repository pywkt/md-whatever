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
md-whatever notes.md
```

---

## What it does

### Opens files and gets out of the way

- A window shows the rendered text in about **0.15 seconds** on a normal
  laptop. It's a native Qt app, not a browser in disguise.
- **Double-click a `.md` file** in your file manager and it opens here (the
  installer offers to set that up).
- **One window per file.** Open several at once with `md-whatever a.md b.md`,
  or read from a pipe: `curl -s … | md-whatever -`.
- **Live reload.** Save the file in your editor and the window updates on its
  own, keeping your place, even with editors that save by replacing the file.
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

- **Editing.** It's a reader. Use your editor; md-whatever reloads when you save.
- **A web engine or JavaScript.** That's the whole point. Pages are drawn by
  [litehtml](https://github.com/litehtml/litehtml), a small HTML/CSS renderer.
- **Network access.** It never fetches anything. **Images from the web aren't
  shown**, and neither are images embedded directly in the file (`data:`
  URLs). Only image files on your disk are loaded.
- **Raw HTML in Markdown.** `<b>`, `<div>`, `<details>` and friends are shown as
  literal text, not rendered. Safer, and simpler.
- **Mermaid diagrams, charts and other "render this code block as a picture"
  extensions.** They'd need JavaScript.
- **Windows or macOS.** It's a Linux app.

**Not supported (at least for now):**

- **Printing or exporting to PDF.**
- **GitHub "alert" boxes** (`> [!NOTE]`). They show as a normal quote.
- **Emoji shortcodes** (`:smile:`). Actual emoji characters (🎉) display fine
  if you have an emoji font.
- **Other Markdown extensions:** `==highlight==`, `H~2~O` / `x^2^`,
  definition lists, `[[wiki links]]`, tables of contents, `\(…\)` / `\[…\]` math
  (use `$…$` and `$$…$$`).
- **Tabs, a sidebar, a file browser** or searching across files.
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
   touched;
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

```
md-whatever FILE [FILE...]     open each file in its own window (paths or file:// URLs)
md-whatever -                  read Markdown from stdin
md-whatever --theme NAME FILE  use a theme just this once
md-whatever --dump-html FILE   print the rendered HTML (after math) and exit
md-whatever --time FILE        print startup timings
md-whatever --version
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
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | zoom in / out / reset |
| `Ctrl+C` | copy the selection |
| `q` / `Ctrl+W` / `Esc` | close (`Esc` closes the find bar first) |

### Right-click menu

Reload · Copy · Find · **Theme** (pick a theme; Follow System / Light / Dark;
Open Themes Folder) · Open Containing Folder.

### Where things live

| Path | What |
|---|---|
| `~/.config/md-whatever/md-whatever.conf` | settings: `theme=`, `appearance=`, `code-theme=` |
| `~/.config/md-whatever/user.css` | your tweaks, applied on top of any theme |
| `~/.config/md-whatever/themes/*.css` | your themes |
| `~/.config/md-whatever/state.conf` | remembered window size and zoom |
| `~/.cache/md-whatever/math` | rendered equations (safe to delete) |
| `~/.local/bin/md-whatever` | the program |

The settings file is optional; md-whatever writes the `theme=` and `appearance=`
lines itself when you use the menu, and leaves the rest of the file alone.

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
syntax-highlighting cmake ninja`, plus `nodejs mathjax` for math.

```bash
cmake -S . -B build -G Ninja -DCMAKE_INSTALL_PREFIX=$HOME/.local
cmake --build build
(cd build && ctest)                          # tests (offscreen; no windows pop up)
cmake --install build                        # ~/.local/bin/md-whatever + data + .desktop
cmake --build build --target set-default     # make md-whatever open .md files
```

Undo: `cmake --build build --target restore-default` puts Okular back as the
default; `cmake --build build --target uninstall` removes the installed files.

Layout: `src/markdown.cpp` turns Markdown into HTML (plain C++, no Qt),
`src/document.cpp` assembles the page, `src/math.cpp` talks to the MathJax
helper (`data/mathjax-helper.cjs`), `src/theme.cpp` handles themes and
settings, and `src/mainwindow.cpp` is the window. `third_party/qlitehtml` is a
vendored copy of the Qt widget for litehtml, with a few local fixes listed in
its `UPSTREAM_COMMIT`.

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
else.

## License

md-whatever's own code is MIT (see [`LICENSE`](LICENSE)). Do whatever.

One catch: the Qt widget in [`third_party/qlitehtml`](third_party/qlitehtml)
is someone else's code under GPL-3.0 (with the Qt exception; license texts in
its `LICENSES` folder). Since it's compiled in, a built md-whatever is covered
by GPL-3.0 as a whole. In practice: use it and change it freely; if you hand
out a built copy, the GPL's "share the source" terms apply. The other libraries
are permissive: litehtml (BSD-3-Clause), md4c (MIT), KSyntaxHighlighting
(MIT), MathJax and its fonts (Apache-2.0).
