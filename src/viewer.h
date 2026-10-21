// The document view: QLiteHtmlWidget plus local-only resource loading,
// math images, reading keys and scroll helpers.
#pragma once

#include <qlitehtmlwidget.h>

#include <QColor>

namespace mdw {

class Viewer : public QLiteHtmlWidget
{
    Q_OBJECT
public:
    explicit Viewer(QWidget *parent = nullptr);

    void setMathColor(const QColor &c) { m_mathColor = c; }

    double scrollRatio() const;
    void setScrollRatio(double r);
    int scrollY() const;
    void setScrollY(int y);

signals:
    void firstPaint();

protected:
    void keyPressEvent(QKeyEvent *event) override;
    void paintEvent(QPaintEvent *event) override;

private:
    QByteArray loadResource(const QUrl &url);
    QColor m_mathColor;
    bool m_painted = false;
};

} // namespace mdw
