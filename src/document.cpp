#include "document.h"
#include "highlight.h"
#include "markdown.h"
#include "theme.h"

namespace mdw {

static std::string emNum(double v)
{
    return QString::number(v, 'f', 3).toStdString();
}

BuiltDocument buildDocument(const BuildInput &in, Highlighter &hl)
{
    BuiltDocument doc;
    MathRenderer &math = MathRenderer::instance();
    bool mathChecked = false, mathAvailable = false;
    const int pxPerEm = qRound(Theme::basePx() * in.mathScale * 2.0); // 2x headroom for headings

    RenderHooks hooks;
    hooks.code = [&](std::string_view lang, std::string_view code) { return hl.render(lang, code); };
    hooks.math = [&](std::string_view texView, bool display) -> std::string {
        ++doc.mathCount;
        const QString tex = QString::fromUtf8(texView.data(), qsizetype(texView.size())).trimmed();
        const std::string src = escapeHtml(tex.toStdString());
        const std::string delim = display ? "$$" : "$";
        auto wrap = [&](const std::string &inner) {
            return display ? "<div class=\"math-display\">" + inner + "</div>\n" : inner;
        };
        const QString key = MathRenderer::keyFor(tex, display);
        if (auto r = math.lookup(key)) {
            if (r->error)
                return wrap("<code class=\"math-error\">" + delim + src + delim + "</code>");
            std::string style = "width:" + emNum(r->widthEm) + "em;height:" + emNum(r->heightEm) + "em";
            if (!display && r->depthEm > 0)
                style += ";position:relative;top:" + emNum(r->depthEm) + "em"; // sit on the baseline
            return wrap("<img class=\"math\" src=\"mdw-math:" + key.toStdString() + "?px="
                        + std::to_string(pxPerEm) + "\" alt=\"" + src + "\" style=\"" + style + "\">");
        }
        if (!mathChecked) {
            mathChecked = true;
            mathAvailable = math.available();
        }
        if (!mathAvailable)
            return wrap("<code class=\"math-source\">" + delim + src + delim + "</code>");
        doc.pendingMath.append({key, tex, display});
        return wrap("<code class=\"math-pending\">" + delim + src + delim + "</code>");
    };

    const QByteArray utf8 = in.markdown.toUtf8();
    const std::string body = renderMarkdown(std::string_view(utf8.constData(), size_t(utf8.size())), hooks);

    QString html;
    html.reserve(qsizetype(body.size()) + in.css.size() + 256);
    html += QStringLiteral("<!DOCTYPE html>\n<html class=\"%1\"><head><meta charset=\"utf-8\"><style>\n")
                .arg(in.dark ? QStringLiteral("dark") : QStringLiteral("light"));
    html += in.css;
    html += QStringLiteral("\n</style></head><body><article class=\"markdown-body\">\n");
    if (!in.banner.isEmpty())
        html += QStringLiteral("<div class=\"banner\">") + in.banner.toHtmlEscaped() + QStringLiteral("</div>\n");
    html += QString::fromStdString(body);
    html += QStringLiteral("</article></body></html>\n");
    doc.html = std::move(html);
    return doc;
}

QString errorMarkdown(const QString &title, const QString &detail)
{
    QString d = detail;
    d.replace(QLatin1Char('`'), QStringLiteral("'"));
    return QStringLiteral("# %1\n\n`%2`\n").arg(title, d);
}

} // namespace mdw
