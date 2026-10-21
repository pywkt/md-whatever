// Markdown -> HTML body using md4c callbacks. No Qt in this file.
#include "markdown.h"

#include <md4c.h>

#include <map>
#include <string>
#include <vector>

namespace mdw {

std::string escapeHtml(std::string_view s)
{
    std::string out;
    out.reserve(s.size() + s.size() / 8);
    for (char c : s) {
        switch (c) {
        case '&': out += "&amp;"; break;
        case '<': out += "&lt;"; break;
        case '>': out += "&gt;"; break;
        case '"': out += "&quot;"; break;
        default: out += c;
        }
    }
    return out;
}

static bool lineIs(std::string_view line, std::string_view what)
{
    while (!line.empty() && (line.back() == '\r' || line.back() == ' ' || line.back() == '\t'))
        line.remove_suffix(1);
    return line == what;
}

std::string_view stripFrontMatter(std::string_view text)
{
    if (text.substr(0, 3) == "\xEF\xBB\xBF")
        text.remove_prefix(3);
    // Front matter: first line is exactly "---", closed by "---" or "...".
    size_t eol = text.find('\n');
    if (eol == std::string_view::npos || !lineIs(text.substr(0, eol), "---"))
        return text;
    size_t pos = eol + 1;
    while (pos < text.size()) {
        size_t next = text.find('\n', pos);
        std::string_view line = text.substr(pos, next == std::string_view::npos ? std::string_view::npos : next - pos);
        if (lineIs(line, "---") || lineIs(line, "..."))
            return next == std::string_view::npos ? std::string_view{} : text.substr(next + 1);
        if (next == std::string_view::npos)
            break;
        pos = next + 1;
    }
    return text; // unclosed: not front matter, render as-is
}

std::string slugify(std::string_view text)
{
    std::string out;
    for (unsigned char c : text) {
        if (c >= 'A' && c <= 'Z')
            out += char(c - 'A' + 'a');
        else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')
            out += char(c);
        else if (c == ' ')
            out += '-';
        else if (c >= 0x80)
            out += char(c); // keep non-ASCII (letters in other scripts)
        // other ASCII punctuation is dropped, as GitHub does
    }
    return out;
}

namespace {

struct ImgInfo {
    std::string src, title;
};

class Renderer
{
public:
    Renderer(const RenderHooks &hooks) : m_hooks(hooks) { m_bufs.emplace_back(); }

    std::string take() { return std::move(m_bufs.front()); }

    static int enterBlock(MD_BLOCKTYPE t, void *d, void *u) { static_cast<Renderer *>(u)->onEnterBlock(t, d); return 0; }
    static int leaveBlock(MD_BLOCKTYPE t, void *d, void *u) { static_cast<Renderer *>(u)->onLeaveBlock(t, d); return 0; }
    static int enterSpan(MD_SPANTYPE t, void *d, void *u) { static_cast<Renderer *>(u)->onEnterSpan(t, d); return 0; }
    static int leaveSpan(MD_SPANTYPE t, void *d, void *u) { static_cast<Renderer *>(u)->onLeaveSpan(t, d); return 0; }
    static int text(MD_TEXTTYPE t, const MD_CHAR *s, MD_SIZE n, void *u) { static_cast<Renderer *>(u)->onText(t, std::string_view(s, n)); return 0; }

private:
    std::string &out() { return m_bufs.back(); }

    // Attribute text: escape normal parts, keep entities verbatim.
    static std::string attr(const MD_ATTRIBUTE &a)
    {
        std::string r;
        if (!a.text)
            return r;
        for (int i = 0; a.substr_offsets[i] < a.size; ++i) {
            std::string_view part(a.text + a.substr_offsets[i], a.substr_offsets[i + 1] - a.substr_offsets[i]);
            switch (a.substr_types[i]) {
            case MD_TEXT_ENTITY: r += part; break;
            case MD_TEXT_NULLCHAR: r += "\xEF\xBF\xBD"; break;
            default: r += escapeHtml(part);
            }
        }
        return r;
    }
    static std::string rawAttr(const MD_ATTRIBUTE &a) { return a.text ? std::string(a.text, a.size) : std::string(); }

    // Escape text and add <wbr> break points inside very long unbroken runs
    // (URLs, paths, hashes), which litehtml would otherwise never wrap.
    void appendBreakable(std::string_view s)
    {
        std::string &o = out();
        for (size_t i = 0; i < s.size(); ++i) {
            const unsigned char c = static_cast<unsigned char>(s[i]);
            if (c == ' ' || c == '\t' || c == '\n') {
                m_run = 0;
            } else if ((c & 0xC0) != 0x80) { // start of a UTF-8 character
                const bool afterPunct = i > 0 && std::string_view("/.-_?&=#:,").find(s[i - 1]) != std::string_view::npos;
                if (m_run >= 32 || (m_run >= 12 && afterPunct)) {
                    o += "<wbr>";
                    m_run = 0;
                }
                ++m_run;
            }
            switch (c) {
            case '&': o += "&amp;"; break;
            case '<': o += "&lt;"; break;
            case '>': o += "&gt;"; break;
            case '"': o += "&quot;"; break;
            default: o += char(c);
            }
        }
    }

    void flushTask()
    {
        if (!m_pendingTask.empty()) {
            out() += m_pendingTask;
            m_pendingTask.clear();
        }
    }

    std::string uniqueSlug(std::string base)
    {
        if (base.empty())
            base = "section";
        int &n = m_slugCounts[base];
        std::string s = n == 0 ? base : base + "-" + std::to_string(n);
        ++n;
        return s;
    }

    static const char *alignStyle(MD_ALIGN a)
    {
        switch (a) {
        case MD_ALIGN_LEFT: return " style=\"text-align:left\"";
        case MD_ALIGN_CENTER: return " style=\"text-align:center\"";
        case MD_ALIGN_RIGHT: return " style=\"text-align:right\"";
        default: return "";
        }
    }

    void onEnterBlock(MD_BLOCKTYPE t, void *d)
    {
        m_run = 0; // block boundaries are break points
        switch (t) {
        case MD_BLOCK_DOC: break;
        case MD_BLOCK_QUOTE: out() += "<blockquote>\n"; break;
        case MD_BLOCK_UL: flushTask(); out() += "<ul>\n"; break;
        case MD_BLOCK_OL: {
            flushTask();
            auto *ol = static_cast<MD_BLOCK_OL_DETAIL *>(d);
            if (ol->start != 1)
                out() += "<ol start=\"" + std::to_string(ol->start) + "\">\n";
            else
                out() += "<ol>\n";
            break;
        }
        case MD_BLOCK_LI: {
            auto *li = static_cast<MD_BLOCK_LI_DETAIL *>(d);
            if (li->is_task) {
                bool done = li->task_mark == 'x' || li->task_mark == 'X';
                out() += "<li class=\"task-item\">";
                m_pendingTask = done ? "<span class=\"task checked\">\xE2\x9C\x93</span> "
                                     : "<span class=\"task\">\xC2\xA0</span> ";
            } else {
                out() += "<li>";
            }
            break;
        }
        case MD_BLOCK_HR: out() += "<hr>\n"; break;
        case MD_BLOCK_H:
            m_headingPlain.clear();
            m_inHeading = true;
            m_bufs.emplace_back();
            break;
        case MD_BLOCK_CODE: {
            auto *c = static_cast<MD_BLOCK_CODE_DETAIL *>(d);
            m_codeLang = rawAttr(c->lang);
            m_code.clear();
            m_inCode = true;
            break;
        }
        case MD_BLOCK_HTML: out() += "<pre class=\"raw-html\"><code>"; break; // not reached with NOHTML
        case MD_BLOCK_P:
            out() += "<p>";
            flushTask();
            break;
        case MD_BLOCK_TABLE: out() += "<table>\n"; break;
        case MD_BLOCK_THEAD: out() += "<thead>\n"; break;
        case MD_BLOCK_TBODY: out() += "<tbody>\n"; break;
        case MD_BLOCK_TR: out() += "<tr>"; break;
        case MD_BLOCK_TH: out() += std::string("<th") + alignStyle(static_cast<MD_BLOCK_TD_DETAIL *>(d)->align) + ">"; break;
        case MD_BLOCK_TD: out() += std::string("<td") + alignStyle(static_cast<MD_BLOCK_TD_DETAIL *>(d)->align) + ">"; break;
        case MD_BLOCK_FOOTNOTE_DEF_SECTION: out() += "<section class=\"footnotes\">\n<ol>\n"; break;
        case MD_BLOCK_FOOTNOTE_DEF: {
            auto *fd = static_cast<MD_BLOCK_FOOTNOTE_DEF_DETAIL *>(d);
            m_footnoteStack.push_back({fd->id, fd->ref_count});
            out() += "<li id=\"fn-" + std::to_string(fd->id) + "\">";
            break;
        }
        default: break;
        }
    }

    void onLeaveBlock(MD_BLOCKTYPE t, void *d)
    {
        m_run = 0;
        switch (t) {
        case MD_BLOCK_DOC: break;
        case MD_BLOCK_QUOTE: out() += "</blockquote>\n"; break;
        case MD_BLOCK_UL: out() += "</ul>\n"; break;
        case MD_BLOCK_OL: out() += "</ol>\n"; break;
        case MD_BLOCK_LI: flushTask(); out() += "</li>\n"; break;
        case MD_BLOCK_HR: break;
        case MD_BLOCK_H: {
            unsigned level = static_cast<MD_BLOCK_H_DETAIL *>(d)->level;
            std::string content = std::move(m_bufs.back());
            m_bufs.pop_back();
            m_inHeading = false;
            std::string lv = std::to_string(level);
            out() += "<h" + lv + " id=\"" + escapeHtml(uniqueSlug(slugify(m_headingPlain))) + "\">" + content + "</h" + lv + ">\n";
            break;
        }
        case MD_BLOCK_CODE: {
            m_inCode = false;
            std::string lang = m_codeLang;
            if (lang == "math" && m_hooks.math) {
                out() += m_hooks.math(m_code, true);
            } else if (m_hooks.code) {
                out() += m_hooks.code(lang, m_code);
            } else {
                out() += "<pre><code" + (lang.empty() ? std::string() : " class=\"language-" + escapeHtml(lang) + "\"")
                         + ">" + escapeHtml(m_code) + "</code></pre>\n";
            }
            break;
        }
        case MD_BLOCK_HTML: out() += "</code></pre>\n"; break;
        case MD_BLOCK_P: out() += "</p>\n"; break;
        case MD_BLOCK_TABLE: out() += "</table>\n"; break;
        case MD_BLOCK_THEAD: out() += "</thead>\n"; break;
        case MD_BLOCK_TBODY: out() += "</tbody>\n"; break;
        case MD_BLOCK_TR: out() += "</tr>\n"; break;
        case MD_BLOCK_TH: out() += "</th>"; break;
        case MD_BLOCK_TD: out() += "</td>"; break;
        case MD_BLOCK_FOOTNOTE_DEF_SECTION: out() += "</ol>\n</section>\n"; break;
        case MD_BLOCK_FOOTNOTE_DEF: {
            auto [id, refs] = m_footnoteStack.back();
            m_footnoteStack.pop_back();
            std::string back;
            for (unsigned r = 1; r <= refs; ++r)
                back += " <a href=\"#fnref-" + std::to_string(id) + "-" + std::to_string(r) + "\" class=\"footnote-back\">\xE2\x86\xA9</a>";
            std::string &o = out();
            static const std::string closeP = "</p>\n";
            if (o.size() >= closeP.size() && o.compare(o.size() - closeP.size(), closeP.size(), closeP) == 0)
                o.insert(o.size() - closeP.size(), back);
            else
                o += back;
            o += "</li>\n";
            break;
        }
        default: break;
        }
    }

    void onEnterSpan(MD_SPANTYPE t, void *d)
    {
        if (t == MD_SPAN_IMG) {
            auto *img = static_cast<MD_SPAN_IMG_DETAIL *>(d);
            flushTask();
            m_imgs.push_back({attr(img->src), attr(img->title)});
            m_bufs.emplace_back(); // collects alt text
            return;
        }
        if (!m_imgs.empty())
            return; // inside image alt text: plain text only
        if (t == MD_SPAN_LATEXMATH || t == MD_SPAN_LATEXMATH_DISPLAY) {
            flushTask();
            m_math.clear();
            m_inMath = true;
            return;
        }
        flushTask();
        switch (t) {
        case MD_SPAN_EM: out() += "<em>"; break;
        case MD_SPAN_STRONG: out() += "<strong>"; break;
        case MD_SPAN_A: {
            auto *a = static_cast<MD_SPAN_A_DETAIL *>(d);
            out() += "<a href=\"" + attr(a->href) + "\"";
            if (a->title.text)
                out() += " title=\"" + attr(a->title) + "\"";
            out() += ">";
            break;
        }
        case MD_SPAN_CODE: out() += "<code>"; break;
        case MD_SPAN_DEL: out() += "<del>"; break;
        case MD_SPAN_U: out() += "<u>"; break;
        case MD_SPAN_FOOTNOTE_REF: {
            auto *f = static_cast<MD_SPAN_FOOTNOTE_REF_DETAIL *>(d);
            std::string id = std::to_string(f->id);
            out() += "<sup class=\"footnote-ref\"><a href=\"#fn-" + id + "\" id=\"fnref-" + id + "-"
                     + std::to_string(f->ref_id) + "\">" + id + "</a></sup>";
            break;
        }
        default: break;
        }
    }

    void onLeaveSpan(MD_SPANTYPE t, void *d)
    {
        (void)d;
        if (t == MD_SPAN_IMG) {
            std::string alt = std::move(m_bufs.back());
            m_bufs.pop_back();
            ImgInfo info = std::move(m_imgs.back());
            m_imgs.pop_back();
            if (m_imgs.empty()) {
                out() += "<img src=\"" + info.src + "\" alt=\"" + alt + "\"";
                if (!info.title.empty())
                    out() += " title=\"" + info.title + "\"";
                out() += ">";
            } else {
                out() += alt; // nested image inside alt text: keep its text only
            }
            return;
        }
        if (!m_imgs.empty())
            return;
        if (t == MD_SPAN_LATEXMATH || t == MD_SPAN_LATEXMATH_DISPLAY) {
            m_inMath = false;
            bool display = t == MD_SPAN_LATEXMATH_DISPLAY;
            auto isSpace = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; };
            if (!display && (m_math.empty() || isSpace(m_math.front()) || isSpace(m_math.back()))) {
                // "$5 and $10" style text: inline math may not start or end with
                // whitespace (the Pandoc/GitHub rule). Show it as typed.
                std::string literal = "$" + m_math + "$";
                for (size_t pos = 0; (pos = literal.find("\\$", pos)) != std::string::npos;)
                    literal.erase(pos, 1); // \$ is an escaped dollar in normal text
                out() += escapeHtml(literal);
                return;
            }
            if (m_hooks.math)
                out() += m_hooks.math(m_math, display);
            else
                out() += "<code class=\"math-source\">" + escapeHtml(m_math) + "</code>";
            return;
        }
        switch (t) {
        case MD_SPAN_EM: out() += "</em>"; break;
        case MD_SPAN_STRONG: out() += "</strong>"; break;
        case MD_SPAN_A: out() += "</a>"; break;
        case MD_SPAN_CODE: out() += "</code>"; break;
        case MD_SPAN_DEL: out() += "</del>"; break;
        case MD_SPAN_U: out() += "</u>"; break;
        default: break;
        }
    }

    void onText(MD_TEXTTYPE t, std::string_view s)
    {
        if (m_inCode) {
            m_code += s;
            return;
        }
        if (m_inMath) {
            if (t == MD_TEXT_SOFTBR || t == MD_TEXT_BR)
                m_math += '\n';
            else
                m_math += s;
            return;
        }
        flushTask();
        bool inAlt = !m_imgs.empty();
        switch (t) {
        case MD_TEXT_NULLCHAR: out() += "\xEF\xBF\xBD"; break;
        case MD_TEXT_BR: out() += inAlt ? " " : "<br>\n"; break;
        case MD_TEXT_SOFTBR: out() += inAlt ? " " : "\n"; m_run = 0; if (m_inHeading) m_headingPlain += ' '; break;
        case MD_TEXT_ENTITY: out() += s; break;
        default:
            if (inAlt)
                out() += escapeHtml(s);
            else
                appendBreakable(s);
            if (m_inHeading)
                m_headingPlain += s;
        }
    }

    const RenderHooks &m_hooks;
    std::vector<std::string> m_bufs;
    std::vector<ImgInfo> m_imgs;
    std::vector<std::pair<unsigned, unsigned>> m_footnoteStack;
    std::map<std::string, int> m_slugCounts;
    std::string m_pendingTask;
    std::string m_headingPlain;
    std::string m_code, m_codeLang, m_math;
    bool m_inHeading = false, m_inCode = false, m_inMath = false;
    int m_run = 0; // characters since the last break opportunity
};

} // namespace

std::string renderMarkdown(std::string_view text, const RenderHooks &hooks)
{
    text = stripFrontMatter(text);
    Renderer r(hooks);
    MD_PARSER p{};
    p.abi_version = 0;
    p.flags = MD_FLAG_TABLES | MD_FLAG_STRIKETHROUGH | MD_FLAG_TASKLISTS | MD_FLAG_PERMISSIVEAUTOLINKS
              | MD_FLAG_FOOTNOTES | MD_FLAG_LATEXMATHSPANS | MD_FLAG_NOHTML;
    p.enter_block = &Renderer::enterBlock;
    p.leave_block = &Renderer::leaveBlock;
    p.enter_span = &Renderer::enterSpan;
    p.leave_span = &Renderer::leaveSpan;
    p.text = &Renderer::text;
    if (md_parse(text.data(), MD_SIZE(text.size()), &p, &r) != 0)
        return "<p>" + escapeHtml(text) + "</p>"; // parser gave up: show source
    return r.take();
}

} // namespace mdw
