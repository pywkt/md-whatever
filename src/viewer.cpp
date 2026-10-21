#include "viewer.h"
#include "math.h"

#include <QFile>
#include <QFileInfo>
#include <QKeyEvent>
#include <QScrollBar>
#include <QUrlQuery>

namespace mdw {

static constexpr qint64 kMaxImageBytes = 64 * 1024 * 1024;

Viewer::Viewer(QWidget *parent)
    : QLiteHtmlWidget(parent)
{
    setFrameShape(QFrame::NoFrame);
    setResourceHandler([this](const QUrl &url) { return loadResource(url); });
    setFocusPolicy(Qt::StrongFocus);
}

QByteArray Viewer::loadResource(const QUrl &rawUrl)
{
    QUrl url = rawUrl.isRelative() ? this->url().resolved(rawUrl) : rawUrl;
    if (url.scheme() == QLatin1String("mdw-math")) {
        const double px = QUrlQuery(url).queryItemValue(QStringLiteral("px")).toDouble();
        return MathRenderer::instance().svgForDisplay(url.path(), m_mathColor, px > 0 ? px : 32);
    }
    // Only local files. Anything else (http, https, data, ...) is refused:
    // this is what keeps the app offline.
    if (!url.isLocalFile())
        return {};
    QFile f(url.toLocalFile());
    if (!QFileInfo(f).isFile() || f.size() > kMaxImageBytes || !f.open(QIODevice::ReadOnly))
        return {};
    return f.readAll();
}

double Viewer::scrollRatio() const
{
    const QScrollBar *sb = verticalScrollBar();
    return sb->maximum() > 0 ? double(sb->value()) / sb->maximum() : 0.0;
}

void Viewer::setScrollRatio(double r)
{
    QScrollBar *sb = verticalScrollBar();
    sb->setValue(qRound(r * sb->maximum()));
}

int Viewer::scrollY() const { return verticalScrollBar()->value(); }
void Viewer::setScrollY(int y) { verticalScrollBar()->setValue(y); }

void Viewer::keyPressEvent(QKeyEvent *event)
{
    QScrollBar *sb = verticalScrollBar();
    const auto mods = event->modifiers() & ~Qt::KeypadModifier;
    if (mods == Qt::NoModifier) {
        switch (event->key()) {
        case Qt::Key_J: sb->triggerAction(QAbstractSlider::SliderSingleStepAdd); return;
        case Qt::Key_K: sb->triggerAction(QAbstractSlider::SliderSingleStepSub); return;
        case Qt::Key_Space: sb->triggerAction(QAbstractSlider::SliderPageStepAdd); return;
        case Qt::Key_G: sb->triggerAction(QAbstractSlider::SliderToMinimum); return;
        default: break;
        }
    } else if (mods == Qt::ShiftModifier) {
        switch (event->key()) {
        case Qt::Key_Space: sb->triggerAction(QAbstractSlider::SliderPageStepSub); return;
        case Qt::Key_G: sb->triggerAction(QAbstractSlider::SliderToMaximum); return;
        default: break;
        }
    }
    QLiteHtmlWidget::keyPressEvent(event); // arrows, PgUp/PgDn, Home/End
}

void Viewer::paintEvent(QPaintEvent *event)
{
    QLiteHtmlWidget::paintEvent(event);
    if (!m_painted && !html().isEmpty()) {
        m_painted = true;
        emit firstPaint();
    }
}

} // namespace mdw
