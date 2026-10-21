#include "highlight.h"
#include "markdown.h"
#include "timing.h"

#include <KSyntaxHighlighting/AbstractHighlighter>
#include <KSyntaxHighlighting/Definition>
#include <KSyntaxHighlighting/Format>
#include <KSyntaxHighlighting/Repository>
#include <KSyntaxHighlighting/State>
#include <KSyntaxHighlighting/Theme>

namespace KSH = KSyntaxHighlighting;

namespace mdread {

namespace {

class HtmlHighlighter : public KSH::AbstractHighlighter
{
public:
    QString html;

    void highlightCode(const QString &code)
    {
        KSH::State state;
        const QStringList lines = code.split(QLatin1Char('\n'));
        for (qsizetype i = 0; i < lines.size(); ++i) {
            if (i == lines.size() - 1 && lines[i].isEmpty())
                break; // trailing newline
            m_line = lines[i];
            state = highlightLine(m_line, state);
            html += QLatin1Char('\n');
        }
        if (html.endsWith(QLatin1Char('\n')))
            html.chop(1);
    }

protected:
    void applyFormat(int offset, int length, const KSH::Format &format) override
    {
        const QString text = m_line.mid(offset, length).toHtmlEscaped();
        if (format.isDefaultTextStyle(theme())) {
            html += text;
            return;
        }
        QString style;
        if (format.hasTextColor(theme()))
            style += QStringLiteral("color:%1;").arg(format.textColor(theme()).name());
        if (format.isBold(theme()))
            style += QStringLiteral("font-weight:bold;");
        if (format.isItalic(theme()))
            style += QStringLiteral("font-style:italic;");
        if (style.isEmpty()) {
            html += text;
            return;
        }
        html += QStringLiteral("<span style=\"%1\">%2</span>").arg(style, text);
    }

private:
    QString m_line;
};

} // namespace

Highlighter::Highlighter() = default;
Highlighter::~Highlighter() = default;

KSH::Repository &Highlighter::repo()
{
    if (!m_repo) {
        m_repo = std::make_unique<KSH::Repository>(); // local definitions only; never downloads
        timing::mark("syntax definitions loaded");
    }
    return *m_repo;
}

void Highlighter::setTheme(const QString &themeName, bool dark)
{
    m_themeName = themeName;
    m_dark = dark;
}

std::string Highlighter::render(std::string_view langView, std::string_view codeView)
{
    const QString lang = QString::fromUtf8(langView.data(), qsizetype(langView.size())).trimmed();
    const std::string langAttr = lang.isEmpty() ? std::string()
        : " data-lang=\"" + escapeHtml(lang.toStdString()) + "\"";
    auto plain = [&] {
        return "<pre class=\"code\"" + langAttr + "><code>" + escapeHtml(codeView) + "</code></pre>\n";
    };
    if (lang.isEmpty())
        return plain();

    KSH::Repository &r = repo();
    KSH::Definition def = r.definitionForName(lang);
    if (!def.isValid())
        def = r.definitionForFileName(QStringLiteral("file.") + lang);
    if (!def.isValid()) {
        // common aliases not covered by file extensions
        static const QHash<QString, QString> aliases = {
            {QStringLiteral("shell"), QStringLiteral("Bash")}, {QStringLiteral("sh"), QStringLiteral("Bash")},
            {QStringLiteral("console"), QStringLiteral("Bash")}, {QStringLiteral("zsh"), QStringLiteral("Zsh")},
            {QStringLiteral("c++"), QStringLiteral("C++")}, {QStringLiteral("cpp"), QStringLiteral("C++")},
            {QStringLiteral("js"), QStringLiteral("JavaScript")}, {QStringLiteral("ts"), QStringLiteral("TypeScript")},
            {QStringLiteral("py"), QStringLiteral("Python")}, {QStringLiteral("rs"), QStringLiteral("Rust")},
            {QStringLiteral("yml"), QStringLiteral("YAML")}, {QStringLiteral("dockerfile"), QStringLiteral("Dockerfile")},
            {QStringLiteral("make"), QStringLiteral("Makefile")}, {QStringLiteral("tex"), QStringLiteral("LaTeX")},
            {QStringLiteral("diff"), QStringLiteral("Diff")}, {QStringLiteral("patch"), QStringLiteral("Diff")},
        };
        const QString a = aliases.value(lang.toLower());
        if (!a.isEmpty())
            def = r.definitionForName(a);
    }
    if (!def.isValid())
        return plain();

    KSH::Theme theme;
    if (!m_themeName.isEmpty())
        theme = r.theme(m_themeName);
    if (!theme.isValid())
        theme = r.defaultTheme(m_dark ? KSH::Repository::DarkTheme : KSH::Repository::LightTheme);

    HtmlHighlighter h;
    h.setDefinition(def);
    h.setTheme(theme);
    h.highlightCode(QString::fromUtf8(codeView.data(), qsizetype(codeView.size())));
    return "<pre class=\"code\"" + langAttr + "><code>" + h.html.toStdString() + "</code></pre>\n";
}

} // namespace mdread
