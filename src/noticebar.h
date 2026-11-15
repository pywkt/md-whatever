// A one-line message strip at the bottom of the window, for things that went
// wrong but don't deserve a dialog (e.g. no editor found). Hides itself.
#pragma once

#include <QTimer>
#include <QWidget>

class QLabel;

namespace mdw {

class NoticeBar : public QWidget
{
    Q_OBJECT
public:
    explicit NoticeBar(QWidget *parent = nullptr);
    void showMessage(const QString &text); // shown for ~10 s, or until closed
    QString text() const;

private:
    QLabel *m_label;
    QTimer m_hideTimer;
};

} // namespace mdw
