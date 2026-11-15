#include "noticebar.h"

#include <QHBoxLayout>
#include <QLabel>
#include <QStyle>
#include <QToolButton>

namespace mdw {

NoticeBar::NoticeBar(QWidget *parent)
    : QWidget(parent)
{
    auto *lay = new QHBoxLayout(this);
    lay->setContentsMargins(8, 4, 8, 4);
    lay->setSpacing(6);

    auto *icon = new QLabel(this);
    const int size = style()->pixelMetric(QStyle::PM_SmallIconSize, nullptr, this);
    icon->setPixmap(QIcon::fromTheme(QStringLiteral("dialog-information")).pixmap(size, size));
    m_label = new QLabel(this);
    m_label->setWordWrap(true);
    m_label->setTextInteractionFlags(Qt::TextSelectableByMouse); // so a suggested setting can be copied
    auto *close = new QToolButton(this);
    close->setIcon(QIcon::fromTheme(QStringLiteral("window-close")));
    close->setToolTip(tr("Close (Esc)"));
    close->setAutoRaise(true);

    lay->addWidget(icon);
    lay->addWidget(m_label, 1);
    lay->addWidget(close);

    m_hideTimer.setSingleShot(true);
    m_hideTimer.setInterval(10000);
    connect(&m_hideTimer, &QTimer::timeout, this, &QWidget::hide);
    connect(close, &QToolButton::clicked, this, &QWidget::hide);
}

void NoticeBar::showMessage(const QString &text)
{
    m_label->setText(text);
    show();
    m_hideTimer.start();
}

QString NoticeBar::text() const { return m_label->text(); }

} // namespace mdw
