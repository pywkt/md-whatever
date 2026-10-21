# md-whatever

A fast, read-only Markdown viewer for Linux. Native Qt window, CSS themes,
math via MathJax, no browser engine, no network access.

```
md-whatever FILE [FILE...]     one window per file (paths or file:// URLs)
md-whatever -                  read from stdin
md-whatever --theme NAME FILE  use a theme for this run
md-whatever --dump-html FILE   print the rendered HTML (waits for math) and exit
md-whatever --time FILE        log startup timings to stderr
```

## Install

On Arch Linux (or anything based on it, like EndeavourOS or Manjaro):

1. Get the code: download it as a ZIP and unpack it, or `git clone` it.
2. Open a terminal in that folder and run:

   ```bash
   ./install.sh
   ```

It checks for the packages md-whatever needs and offers to install any that are
missing (it asks for your password for that), builds md-whatever, installs it into
your home folder, and asks whether `.md` files should open with it. Run it
again to update after getting newer code. To remove md-whatever, run
`./install.sh --uninstall`; that also puts your previous Markdown app back.

Other distributions: install the equivalents of the packages listed in
`install.sh` first (Qt 6.5+, litehtml 0.10, KDE Frameworks 6
syntax-highlighting, md4c, CMake), then run the same script.

## Building by hand

Needs (Arch): `qt6-base qt6-svg litehtml md4c syntax-highlighting cmake ninja`,
plus `nodejs mathjax` for math. The first configure downloads the MathJax font
data (`@mathjax/mathjax-newcm-font` 4.1.3, hash-checked) — the only network
access, and only at build time.

```bash
cmake -S . -B build -G Ninja -DCMAKE_INSTALL_PREFIX=$HOME/.local
cmake --build build
(cd build && ctest)                         # tests
cmake --install build                       # ~/.local/bin/md-whatever + data + .desktop
cmake --build build --target set-default    # make md-whatever open .md files
```

Undo: `cmake --build build --target restore-default` (puts Okular back as the
default), `cmake --build build --target uninstall`.

## Keys

| Key | Action |
|---|---|
| `j`/`k`, arrows | scroll a line |
| `Space`/`Shift+Space`, `PgDn`/`PgUp` | scroll a page |
| `g`/`G`, `Home`/`End` | top / bottom |
| `/` or `Ctrl+F` | find (Enter / Shift+Enter: next / previous) |
| `n`/`N`, `F3`/`Shift+F3` | next / previous match |
| `Alt+Left` / `Alt+Right` | back / forward |
| `r` / `F5` | reload |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | zoom in / out / reset |
| `Ctrl+C` | copy selection |
| `q` / `Ctrl+W` / `Esc` | close (Esc closes the find bar first) |

Right-click for Reload, Copy, Find, Theme and Open Containing Folder. Files reload by
themselves when saved. Links to other `.md` files open in the same window;
web links open in your browser.

## Themes

Everything about how documents look is CSS, and files are reloaded live when
you save them, so you can tweak with the document open.

- **Small tweaks:** `~/.config/md-whatever/user.css`. It's loaded after the theme.
- **Pick a theme:** right-click → Theme. That restyles every open window and
  saves `theme=NAME` in `~/.config/md-whatever/md-whatever.conf` (the rest of the file is
  left as it is). Or edit that line yourself, or use `md-whatever --theme paper
  file.md` for one run. Built in: `default` (follows the system palette and
  fonts) and `paper` (warm serif).
- **Light or dark:** right-click → Theme → Follow System / Light / Dark (saved
  as `appearance=` in `md-whatever.conf`). Every theme has both versions; forcing
  the opposite of the system mode uses Breeze Light/Dark colors with your
  accent color.
- **Your own theme:** `~/.config/md-whatever/themes/NAME.css`. Start from a copy of
  [`src/themes/default.css`](src/themes/default.css) or one of the examples. A
  user theme named like a built-in one replaces it.
- **Example themes** in [`examples/themes/`](examples/themes/): `github`,
  `catppuccin` (Latte/Mocha, pink accent), `terminal` (all monospace) and
  `book` (Charter, indented paragraphs). Copy them to
  `~/.config/md-whatever/themes/` to use them. Each one names a matching
  `code-theme` at the top. [`examples/user.css.example`](examples/user.css.example)
  has commented tweaks.
- **Code colors:** `code-theme=Solarized Dark` in `md-whatever.conf` (any
  KSyntaxHighlighting theme name, as in Kate). Default: Breeze Light/Dark.

Themes use these variables, filled in from the system palette and fonts.
Override any of them in `:root` (or in `html.dark` / `html.light` for one mode):

| Variable | Default from |
|---|---|
| `--bg`, `--text` | palette Base / Text |
| `--muted`, `--faint` | text mixed toward the background |
| `--rule` | lines: headings, tables, rules |
| `--code-bg`, `--code-border` | code blocks and inline code |
| `--quote-bg`, `--table-head`, `--table-stripe` | blockquote, table header, zebra rows |
| `--link`, `--accent`, `--accent-text` | palette Link / Highlight (your accent color) |
| `--error` | math errors |
| `--body-font`, `--mono-font` | system font / fixed-width font |
| `--base-size` | body text size (UI font size × 1.2) |

Example `user.css`:

```css
:root {
  --body-font: "Noto Sans";   /* a proportional font for reading */
  --base-size: 17px;
}
html.dark { --bg: #1b1b1f; }
h1, h2 { border-bottom: 0 solid var(--rule); }   /* see the var() quirk below */
.markdown-body { max-width: 52em; }   /* wider text column */
```

Useful selectors: `.markdown-body` (the text column), `pre.code`, `code`,
`blockquote`, `table`/`th`/`td`, `.task`/`.task.checked` (task boxes),
`.footnotes`, `.math-display`, `img.math`, `.math-error`, `.banner`.

The renderer is [litehtml](https://github.com/litehtml/litehtml): CSS 2.1 plus
some CSS 3 (`var()`, `border-radius`, `max-width`, `:nth-child`, `::before`
content). There's no JavaScript, `vertical-align` lengths, `word-break`,
`text-transform`, `letter-spacing`, shadows or flexbox/grid — see `NOTES.md`.

**One quirk to know:** a value that uses `var()` beats any plain value, whatever
the selector or order. So if a rule sets `border-bottom: 1px solid var(--rule)`,
`border-bottom: 0` won't remove it — write `border-bottom: 0 solid var(--rule)`.
For backgrounds, `background: var(--clear)` is transparent.

## Math

`$inline$`, `$$display$$` and ```` ```math ```` blocks are rendered by MathJax 4
(the same engine GitHub uses) running under the system `node`, started only
when a document has math. Text appears first; equations fill in a moment later
and are cached in `~/.cache/md-whatever/math`, so reopening is instant. Without
`node` or `mathjax`, the TeX source is shown instead.
