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
#pragma once

#include <string>
#include <string_view>

namespace mdw::web {

std::string render(std::string_view markdown);
std::string slug(std::string_view text);

} // namespace mdw::web
