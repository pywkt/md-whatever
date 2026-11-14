# md-whatever, in a browser tab

This page runs [md-whatever](https://github.com/pywkt/md-whatever)'s own Markdown engine. Its C++ source is compiled to WebAssembly and embedded in this file, and the result is styled with md-whatever's own theme files. The desktop app shows one window per file. Here every open file gets a row in the sidebar on the left, and you switch between them there.

This file is a sample. It closes by itself when you open your first file.

## Open something

- **Open files** in the sidebar, or press `o`. Pick as many as you like.
- **Open folder** adds every Markdown file inside the folder. Relative images and links between those files then work.
- **Drop** files or a folder anywhere on the page.
- **Paste** Markdown text to read it without saving it first.

Files are read and rendered inside this page. Nothing you open is uploaded anywhere.

## Get around

| Key | Action |
|---|---|
| `[` / `]` | previous / next open file |
| `j` / `k`, arrows | scroll a line |
| `Space` / `Shift+Space` | scroll a page |
| `g` / `G` | top / bottom |
| `+` / `-` / `0` | zoom in / out / reset |
| `r` | reload the current file from disk |
| `o` | open files |

Click a row in the sidebar to switch files. The × on a row closes it, and so does a middle click.

## What carries over from the desktop app

- [x] The Markdown engine: tables, task lists, footnotes[^engine], ~~strikethrough~~, front matter, bare links like https://github.com/pywkt/md-whatever
- [x] Every theme: `default` and `paper`, plus the `github`, `catppuccin`, `terminal` and `book` examples, each in light and dark
- [x] Math such as $e^{i\pi} + 1 = 0$, typeset by MathJax with the app's settings
- [x] Links to other `.md` files open here, and `#section` links scroll
- [x] Live reload: save a file in your editor and the page updates, keeping your place
- [ ] Raw HTML stays literal text, as in the app: <b>not bold</b>

Three things work differently in a browser:

1. **Code colors** come from highlight.js with Breeze colors. The app uses KDE's syntax-highlighting library, which needs Qt.
2. **Live reload** needs a Chromium-based browser (Chrome, Edge, Brave, Arc). In Firefox and Safari, open the file again to refresh it.
3. **Math and code colors** load their libraries from a CDN the first time a document needs them. Offline, math shows as TeX source and code stays plain, which is what the app does without MathJax installed.

```cpp
// src/markdown.h: the function this page calls for every file you open
std::string renderMarkdown(std::string_view text, const RenderHooks &hooks = {});
```

## Samples

md-whatever's own test documents are bundled with this page:

- [kitchen-sink.md](kitchen-sink.md) has every construct the engine renders
- [math.md](math.md) is the math showcase
- [README.md](README.md) is md-whatever's README

[^engine]: `src/markdown.cpp` and [md4c](https://github.com/mity/md4c), both MIT licensed.
