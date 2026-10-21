// Tests for markdown.cpp only (no window, no theme). Structure, not exact HTML.
#include "markdown.h"

#include <QTest>

using namespace mdw;

static QString render(const char *md, const RenderHooks &hooks = {})
{
    return QString::fromStdString(renderMarkdown(md, hooks));
}

class TestMarkdown : public QObject
{
    Q_OBJECT
private slots:
    void headingsGetUniqueIds()
    {
        const QString h = render("# Hello World\n\n## Hello World\n\n### What's `new`?\n");
        QVERIFY(h.contains(QLatin1String("<h1 id=\"hello-world\">")));
        QVERIFY(h.contains(QLatin1String("<h2 id=\"hello-world-1\">")));
        QVERIFY(h.contains(QLatin1String("<h3 id=\"whats-new\">")));
    }
    void rawHtmlIsEscaped()
    {
        const QString h = render("<script>alert(1)</script>\n\nhi <b onclick=x>there</b>\n");
        QVERIFY(!h.contains(QLatin1String("<script")));
        QVERIFY(!h.contains(QLatin1String("<b ")));
        QVERIFY(h.contains(QLatin1String("&lt;script&gt;")));
    }
    void tablesWithAlignment()
    {
        const QString h = render("| a | b |\n|:--|--:|\n| 1 | 2 |\n");
        QVERIFY(h.contains(QLatin1String("<table>")));
        QVERIFY(h.contains(QLatin1String("text-align:right")));
    }
    void taskListsHaveNoInputs()
    {
        const QString h = render("- [x] done\n- [ ] todo\n");
        QVERIFY(!h.contains(QLatin1String("<input")));
        QVERIFY(h.contains(QLatin1String("task checked")));
        QCOMPARE(h.count(QLatin1String("<span class=\"task")), 2);
    }
    void codeBlocksUseHookAndNeverThrow()
    {
        RenderHooks hooks;
        QString seenLang;
        hooks.code = [&](std::string_view lang, std::string_view code) {
            seenLang = QString::fromUtf8(lang.data(), qsizetype(lang.size()));
            return "<pre>" + escapeHtml(code) + "</pre>";
        };
        const QString h = render("```rust\nfn main() {}\n```\n", hooks);
        QCOMPARE(seenLang, QStringLiteral("rust"));
        QVERIFY(h.contains(QLatin1String("<pre>fn main() {}")));
        QVERIFY(render("```\nunclosed fence\n").contains(QLatin1String("<pre>")));
    }
    void mathSpansAndFences()
    {
        RenderHooks hooks;
        QStringList seen;
        hooks.math = [&](std::string_view tex, bool display) {
            seen << (display ? QStringLiteral("D:") : QStringLiteral("I:")) + QString::fromUtf8(tex.data(), qsizetype(tex.size()));
            return std::string("<m/>");
        };
        render("Inline $x^2$ and\n\n$$\\int_0^1 f$$\n\n```math\na = b\n```\n", hooks);
        QCOMPARE(seen.size(), 3);
        QCOMPARE(seen[0], QStringLiteral("I:x^2"));
        QVERIFY(seen[1].startsWith(QLatin1String("D:\\int_0^1 f")));
        QVERIFY(seen[2].startsWith(QLatin1String("D:a = b")));
    }
    void currencyIsNotMath()
    {
        int calls = 0;
        RenderHooks hooks;
        hooks.math = [&](std::string_view, bool) { ++calls; return std::string(); };
        render("It costs $5 and $10 today.\n", hooks);
        QCOMPARE(calls, 0);
        const QString h = render("It costs $5 and $10, so \\$15 in total. A lone dollar: $\n", hooks);
        QCOMPARE(calls, 0);
        QVERIFY(h.contains(QLatin1String("so $15 in total")));
    }
    void footnotes()
    {
        const QString h = render("Text[^1].\n\n[^1]: The note.\n");
        QVERIFY(h.contains(QLatin1String("href=\"#fn-1\"")));
        QVERIFY(h.contains(QLatin1String("id=\"fn-1\"")));
        QVERIFY(h.contains(QLatin1String("footnote-back")));
    }
    void frontMatterIsHidden()
    {
        const QString h = render("---\ntitle: Secret\n---\n# Visible\n");
        QVERIFY(!h.contains(QLatin1String("Secret")));
        QVERIFY(h.contains(QLatin1String("Visible")));
        // a leading thematic break with no closing line is not front matter
        QVERIFY(render("---\n\ntext\n").contains(QLatin1String("text")));
    }
    void imagesKeepAltText()
    {
        const QString h = render("![a *cat*](cat.png \"Title\")\n");
        QVERIFY(h.contains(QLatin1String("<img src=\"cat.png\" alt=\"a cat\" title=\"Title\">")));
    }
    void longRunsGetBreakPoints()
    {
        const QString h = render("See https://example.com/a/very/long/path/that/goes/on/and/on/index.html now\n");
        QVERIFY(h.contains(QLatin1String("<wbr>")));
        QVERIFY(h.contains(QLatin1String("href=\"https://example.com/a/very/long/path/that/goes/on/and/on/index.html\"")));
        QVERIFY(!render("short words only here\n").contains(QLatin1String("<wbr>")));
        // table cells are separate runs
        QVERIFY(!render("|ID|Name|Description|Owner|Created|Updated|\n|-|-|-|-|-|-|\n|1|alpha|beta|gamma|delta|epsilon|\n")
                     .contains(QLatin1String("<wbr>")));
    }
    void pathologicalInput()
    {
        QVERIFY(!render("").contains(QLatin1String("<p>")));
        QVERIFY(render("line\r\nnext\r\n").contains(QLatin1String("line")));
        QVERIFY(render("\xEF\xBB\xBF# BOM\n").contains(QLatin1String("<h1")));
    }
};

QTEST_APPLESS_MAIN(TestMarkdown)
#include "test_markdown.moc"
