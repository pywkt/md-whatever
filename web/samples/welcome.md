# md-whatever, in a browser tab

This page runs [md-whatever](https://github.com/pywkt/md-whatever)'s own Markdown engine. Its C++ source is compiled to WebAssembly and embedded in this file, and the result is styled with md-whatever's own theme files. The desktop app shows one window per file. Here every open file gets a row in the sidebar on the left, and you switch between them there.

This file is a sample. It closes by itself when you open your first file.

## Open something

- **Open files** in the sidebar, or press `o`. Pick as many as you like.
- **Open folder** adds every Markdown file inside the folder. Relative images and links between those files then work.
- **Drop** files or a folder anywhere on the page.
- **Paste** Markdown text to read it without saving it first.
- **New file** in the sidebar, or `n`, starts an empty one to write in.

Files are read and rendered inside this page. Nothing you open is uploaded anywhere, unless you share it (below). The page itself and the libraries for code colors and math do come from the web, and are kept for offline use once fetched. Images from the web stay off unless you turn on "Load images from the web".

In Chrome, Edge, Brave or Arc, files you opened are listed under **Recent** in the sidebar, so you can open them again next time with one click.

## Use it like an app

At [md.wtvr.sh](https://md.wtvr.sh/) you can install the reader, and it then works offline too:

- **Chrome, Edge, Brave:** click the install button at the right of the address bar. On a Mac, Markdown files then offer md-whatever under **Open With** in Finder. Choose it in **Get Info → Open with → Change All** to make it the default.
- **Safari** (macOS Sonoma or later): **File → Add to Dock**. Safari apps can't be picked in Open With, so drop files onto the window instead.

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
| `n` | new file |
| `e` / `Esc` | edit the source / back to reading |
| `t` | formatting toolbar |
| `⌘S` / `Ctrl+S` | save |

Click a row in the sidebar to switch files. The × on a row closes it, and so does a middle click.

## Edit

Press **Edit** in the top bar, or `e`, to change a file's Markdown source. **Read** or `Esc` shows the result. A dot before a file's name means it has unsaved changes.

To format while you read, press the **A** button next to Edit, or `t`. A toolbar drops down: select some text on this page (or click into a paragraph) and make it bold, italic, a link, a heading, a list or a quote. `⌘B` / `Ctrl+B`, `⌘I` / `Ctrl+I` and `⌘K` / `Ctrl+K` work too, and `⌘Z` / `Ctrl+Z` undoes. The toolbar changes only the Markdown it needs to, and works on the source in Edit as well.

What **Save** does depends on the browser:

- **Chrome, Edge, Brave, Arc:** saves to the file you opened. The first save of each file asks for permission to write to it. `⌘⇧S` / `Ctrl+Shift+S` saves to a new file instead.
- **Safari, Firefox:** these browsers can't write to your files, so Save downloads a copy, and the original file stays as it was.

Saving keeps the file's line endings, encoding and byte order mark. If the file changes on disk while you have unsaved changes, you choose which version to keep. Samples like this page can be edited too, and saving one makes a new file. So does the first save of a new file, which suggests a name from its first heading.

## Share

On [md.wtvr.sh](https://md.wtvr.sh/), the share button in the top bar (next to **A**) turns the open file into a link that works for 1, 7 or 30 days. The file is encrypted in your browser first, and the key is the end of the link after the `#`, which never leaves the browser, so only people with the link can read it. A link shows the file as it was when you made it; **Stop sharing** deletes it.

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
