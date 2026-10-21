# mdread

A fast, read-only Markdown viewer for Linux. Native Qt window, CSS themes,
math via MathJax, no browser engine, no network access.

```
mdread FILE [FILE...]     one window per file (paths or file:// URLs)
mdread -                  read from stdin
mdread --theme NAME FILE  use a theme for this run
mdread --dump-html FILE   print the rendered HTML (waits for math) and exit
mdread --time FILE        log startup timings to stderr
```

## Build and install

Needs (Arch): `qt6-base qt6-svg qt6-tools litehtml md4c syntax-highlighting
mathjax nodejs cmake ninja`. The first configure downloads the MathJax font
data (`@mathjax/mathjax-newcm-font` 4.1.3, hash-checked) — the only network
access, and only at build time.

```bash
cmake -S . -B build -G Ninja -DCMAKE_INSTALL_PREFIX=$HOME/.local
cmake --build build
(cd build && ctest)                         # tests
cmake --install build                       # ~/.local/bin/mdread + data + .desktop
cmake --build build --target set-default    # make mdread open .md files
```

Undo: `cmake --build build --target restore-default` (Okular back as default),
`cmake --build build --target uninstall`.

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

Right-click for Reload, Copy, Find and Open Containing Folder. Files reload by
themselves when saved. Links to other `.md` files open in the same window;
web links open in your browser.

## Themes

Everything about how documents look is CSS, and files are reloaded live when
you save them, so you can tweak with the document open.

- **Small tweaks:** `~/.config/mdread/user.css`. It's loaded after the theme.
- **Pick a theme:** `theme=paper` in `~/.config/mdread/mdread.conf`, or
  `mdread --theme paper file.md`. Built in: `default` (follows the system
  palette and fonts) and `paper` (warm serif).
- **Your own theme:** `~/.config/mdread/themes/NAME.css`. Start from a copy of
  [`src/themes/default.css`](src/themes/default.css) or one of the examples. A
  user theme named like a built-in one replaces it.
- **Example themes** in [`examples/themes/`](examples/themes/): `github`,
  `catppuccin` (Latte/Mocha, pink accent), `terminal` (all monospace) and
  `book` (Charter, indented paragraphs). Copy them to
  `~/.config/mdread/themes/` to use them. Each one names a matching
  `code-theme` at the top. [`examples/user.css.example`](examples/user.css.example)
  has commented tweaks.
- **Code colors:** `code-theme=Solarized Dark` in `mdread.conf` (any
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
and are cached in `~/.cache/mdread/math`, so reopening is instant. Without
`node` or `mathjax`, the TeX source is shown instead.
