// Code highlighting with KSyntaxHighlighting (Kate's engine), emitted as
// HTML spans with inline colors. The definition repository loads lazily.
#pragma once

#include <QString>
#include <memory>
#include <string>
#include <string_view>

namespace KSyntaxHighlighting { class Repository; }

namespace mdw {

class Highlighter
{
public:
    Highlighter();
    ~Highlighter();

    // themeName empty = Breeze Light/Dark by `dark`.
    void setTheme(const QString &themeName, bool dark);

    // Full <pre> block HTML for a code block.
    std::string render(std::string_view lang, std::string_view code);

private:
    KSyntaxHighlighting::Repository &repo();
    std::unique_ptr<KSyntaxHighlighting::Repository> m_repo;
    QString m_themeName;
    bool m_dark = false;
};

} // namespace mdw
