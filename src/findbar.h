// Inline find bar shown at the bottom of the window.
#pragma once

#include <QWidget>

class QLineEdit;
class QLabel;

namespace mdread {

class FindBar : public QWidget
{
    Q_OBJECT
public:
    explicit FindBar(QWidget *parent = nullptr);
    QString text() const;
    void activate();               // show, focus, select existing text
    void setStatus(const QString &s, bool bad);

signals:
    void searchChanged(const QString &text); // as you type
    void findNext();
    void findPrevious();
    void closeRequested();

protected:
    void keyPressEvent(QKeyEvent *e) override;

private:
    QLineEdit *m_edit;
    QLabel *m_status;
};

} // namespace mdread
