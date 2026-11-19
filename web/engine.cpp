#include "engine.h"
#include "markdown.h"

#include <cstdlib>

namespace mdw::web {

namespace {

// Byte length of the whitespace character at s[i] (UTF-8), or 0. The same
// set as QChar::isSpace, so trimming matches the desktop app's
// QString::trimmed() in highlight.cpp and document.cpp.
size_t spaceLen(std::string_view s, size_t i)
{
    const auto b = [&](size_t k) { return i + k < s.size() ? static_cast<unsigned char>(s[i + k]) : 0u; };
    const unsigned c = b(0);
    if (c == ' ' || (c >= 0x09 && c <= 0x0D))
        return 1;
    if (c == 0xC2 && (b(1) == 0x85 || b(1) == 0xA0)) // U+0085, U+00A0
        return 2;
    if (c == 0xE1 && b(1) == 0x9A && b(2) == 0x80) // U+1680
        return 3;
    if (c == 0xE2 && b(1) == 0x80 && ((b(2) >= 0x80 && b(2) <= 0x8A) || b(2) == 0xA8 || b(2) == 0xA9 || b(2) == 0xAF))
        return 3; // U+2000..200A, U+2028, U+2029, U+202F
    if (c == 0xE2 && b(1) == 0x81 && b(2) == 0x9F) // U+205F
        return 3;
    if (c == 0xE3 && b(1) == 0x80 && b(2) == 0x80) // U+3000
        return 3;
    return 0;
}

std::string_view trimmed(std::string_view s)
{
    size_t n;
    while (!s.empty() && (n = spaceLen(s, 0)) > 0)
        s.remove_prefix(n);
    // From the end: find the last character start and test it.
    for (;;) {
        size_t start = s.size();
        while (start > 0 && (static_cast<unsigned char>(s[start - 1]) & 0xC0) == 0x80)
            --start; // continuation bytes
        if (start == 0)
            break;
        --start;
        if (spaceLen(s, start) != s.size() - start)
            break;
        s.remove_suffix(s.size() - start);
    }
    return s;
}

} // namespace

std::string render(std::string_view markdown, bool sourceMap)
{
    RenderHooks hooks;
    hooks.sourceMap = sourceMap;
    hooks.code = [](std::string_view langView, std::string_view code) {
        const std::string_view lang = trimmed(langView);
        std::string out = "<pre class=\"code\"";
        if (!lang.empty())
            out += " data-lang=\"" + escapeHtml(lang) + "\"";
        out += "><code>" + escapeHtml(code) + "</code></pre>\n";
        return out;
    };
    hooks.math = [](std::string_view texView, bool display) {
        const std::string src = escapeHtml(trimmed(texView));
        if (display)
            return "<span class=\"math-display\"><code class=\"math-pending\">$$" + src + "$$</code></span>\n";
        return "<code class=\"math-pending\">$" + src + "$</code>";
    };
    return renderMarkdown(markdown, hooks);
}

std::string slug(std::string_view text)
{
    return slugify(text);
}

} // namespace mdw::web

#if defined(__wasm__)
// --- WebAssembly exports ------------------------------------------------------
// The page copies UTF-8 input into memory from mdw_alloc(), calls mdw_render,
// mdw_render_mapped or mdw_slugify, then reads mdw_result_len() bytes at mdw_result_ptr(). The result
// stays valid until the next call.
namespace {
std::string g_result;
}

#define MDW_EXPORT(name) extern "C" __attribute__((export_name(#name)))

MDW_EXPORT(mdw_alloc) void *mdw_alloc(size_t n) { return std::malloc(n ? n : 1); }
MDW_EXPORT(mdw_free) void mdw_free(void *p) { std::free(p); }
MDW_EXPORT(mdw_render) void mdw_render(const char *s, size_t n) { g_result = mdw::web::render(std::string_view(s, n)); }
MDW_EXPORT(mdw_render_mapped) void mdw_render_mapped(const char *s, size_t n) { g_result = mdw::web::render(std::string_view(s, n), true); }
MDW_EXPORT(mdw_slugify) void mdw_slugify(const char *s, size_t n) { g_result = mdw::web::slug(std::string_view(s, n)); }
MDW_EXPORT(mdw_result_ptr) const char *mdw_result_ptr() { return g_result.data(); }
MDW_EXPORT(mdw_result_len) size_t mdw_result_len() { return g_result.size(); }
#endif
