#include "findbar.h"

#include <QHBoxLayout>
#include <QKeyEvent>
#include <QLabel>
#include <QLineEdit>
#include <QToolButton>

namespace mdread {

FindBar::FindBar(QWidget *parent)
    : QWidget(parent)
{
    auto *lay = new QHBoxLayout(this);
    lay->setContentsMargins(8, 4, 8, 4);
    lay->setSpacing(4);

    m_edit = new QLineEdit(this);
    m_edit->setPlaceholderText(tr("Find…"));
    m_edit->setClearButtonEnabled(true);
    m_edit->setMaximumWidth(360);

    auto button = [this](const char *icon, const QString &tip) {
        auto *b = new QToolButton(this);
        b->setIcon(QIcon::fromTheme(QLatin1String(icon)));
        b->setToolTip(tip);
        b->setAutoRaise(true);
        return b;
    };
    QToolButton *prev = button("go-up", tr("Previous match (Shift+Enter)"));
    QToolButton *next = button("go-down", tr("Next match (Enter)"));
    QToolButton *close = button("window-close", tr("Close (Esc)"));
    m_status = new QLabel(this);

    lay->addWidget(m_edit);
    lay->addWidget(prev);
    lay->addWidget(next);
    lay->addWidget(m_status);
    lay->addStretch();
    lay->addWidget(close);

    connect(m_edit, &QLineEdit::textEdited, this, &FindBar::searchChanged);
    connect(prev, &QToolButton::clicked, this, &FindBar::findPrevious);
    connect(next, &QToolButton::clicked, this, &FindBar::findNext);
    connect(close, &QToolButton::clicked, this, &FindBar::closeRequested);
}

QString FindBar::text() const { return m_edit->text(); }

void FindBar::activate()
{
    show();
    m_edit->setFocus();
    m_edit->selectAll();
}

void FindBar::setStatus(const QString &s, bool bad)
{
    m_status->setText(s);
    QPalette p = palette();
    if (bad)
        p.setColor(QPalette::WindowText, QColor(0xda, 0x44, 0x53));
    m_status->setPalette(p);
}

void FindBar::keyPressEvent(QKeyEvent *e)
{
    if (e->key() == Qt::Key_Return || e->key() == Qt::Key_Enter) {
        if (e->modifiers() & Qt::ShiftModifier)
            emit findPrevious();
        else
            emit findNext();
        return;
    }
    if (e->key() == Qt::Key_Escape) {
        emit closeRequested();
        return;
    }
    QWidget::keyPressEvent(e);
}

} // namespace mdread
