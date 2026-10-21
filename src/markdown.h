// Markdown -> HTML body. Pure C++: no Qt includes here or in markdown.cpp.
#pragma once

#include <functional>
#include <string>
#include <string_view>

namespace mdw {

struct RenderHooks {
    // Return HTML for a fenced/indented code block. lang may be empty.
    // If unset, code is emitted as an escaped <pre><code>.
    std::function<std::string(std::string_view lang, std::string_view code)> code;
    // Return HTML for a math expression. If unset, the TeX is shown as code.
    std::function<std::string(std::string_view tex, bool display)> math;
};

// Renders body HTML only (no <html>/<head>). Raw HTML in the input is escaped,
// never passed through. Never throws on malformed input.
std::string renderMarkdown(std::string_view text, const RenderHooks &hooks = {});

// Helpers shared with the rest of the app.
std::string escapeHtml(std::string_view s);
std::string_view stripFrontMatter(std::string_view text);
// GitHub-style heading slug: lowercase, spaces -> '-', punctuation dropped.
std::string slugify(std::string_view text);

} // namespace mdw
