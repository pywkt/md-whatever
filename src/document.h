// Builds the full HTML page for a Markdown document: theme CSS, body,
// highlighted code and math (cached images, or placeholders while rendering).
#pragma once

#include "math.h"

#include <QList>
#include <QString>

namespace mdw {

class Highlighter;

struct BuildInput {
    QString markdown;
    QString css;
    bool dark = false;
    QString banner;        // optional notice shown above the document
    double mathScale = 1;  // zoom * device pixel ratio, for sharp math images
};

struct BuiltDocument {
    QString html;
    QList<MathRequest> pendingMath; // expressions not yet rendered
    int mathCount = 0;
};

BuiltDocument buildDocument(const BuildInput &in, Highlighter &hl);

// Markdown text for error pages (missing file, no permission, ...).
QString errorMarkdown(const QString &title, const QString &detail);

} // namespace mdw
