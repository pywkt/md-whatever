// The web reader's Markdown engine: md-whatever's renderMarkdown() with the
// hooks the browser page expects. Compiled to WebAssembly for the page (see
// web/build.py) and natively for tests/web, so the two can be compared.
//
// Output contract that web/reader.js relies on:
//   code:           <pre class="code" data-lang="LANG"><code>ESCAPED</code></pre>
//                   (no data-lang without a language; reader.js colors it)
//   inline math:    <code class="math-pending">$TEX$</code>
//   display math:   <span class="math-display"><code class="math-pending">$$TEX$$</code></span>
//                   (a span, not the desktop's div: browsers won't nest a div in a <p>)
// TeX is trimmed and HTML-escaped; reader.js reads it back with textContent.
//
// render(text, true) adds a source map for the formatting toolbar (see
// RenderHooks::sourceMap in src/markdown.h), offsets in UTF-16 code units:
//   text from the input:  <span data-s="OFFSET">TEXT</span>
//   entity, \-escape:      <span data-s="OFFSET" data-n="SOURCE LENGTH">X</span>
//   code block, math:     data-s="BEGIN" data-e="END" on the first tag above
//                         (pre.code / code.math-pending / span.math-display):
//                         the source range of the code or TeX between the
//                         fences or dollars
// Nothing else changes, so render(text) and render(text, true) look the same.
#pragma once

#include <string>
#include <string_view>

namespace mdw::web {

std::string render(std::string_view markdown, bool sourceMap = false);
std::string slug(std::string_view text);

} // namespace mdw::web
