// Math rendering: TeX -> SVG via a MathJax helper running under node.
// Results are cached in memory and on disk (~/.cache/md-whatever/math).
#pragma once

#include <QByteArray>
#include <QColor>
#include <QHash>
#include <QObject>
#include <QProcess>
#include <QSet>
#include <QString>
#include <optional>

namespace mdw {

struct MathResult {
    bool error = false;
    QString message;  // error text from MathJax
    QByteArray svg;   // uses currentColor; sized in ex
    // Geometry in em of the surrounding text, from the SVG viewBox (1000 units = 1 em).
    double widthEm = 0, heightEm = 0, depthEm = 0;
};

struct MathRequest {
    QString key, tex;
    bool display = false;
};

class MathRenderer : public QObject
{
    Q_OBJECT
public:
    static MathRenderer &instance();

    static QString keyFor(const QString &tex, bool display);

    // False if node, MathJax or the helper script can't be found.
    bool available();
    QString unavailableReason() const { return m_reason; }

    std::optional<MathResult> lookup(const QString &key);

    // Render anything not already cached or in flight. Emits resultsReady()
    // as results arrive (batched), and failed() if the helper can't run.
    void request(const QList<MathRequest> &reqs);
    bool busy() const { return !m_inFlight.isEmpty(); }

    // SVG bytes ready for display: color applied, sized in device pixels.
    QByteArray svgForDisplay(const QString &key, const QColor &color, double pxPerEm);

signals:
    void resultsReady();
    void failed();

private:
    MathRenderer();
    void startHelper();
    void onReadyRead();
    void store(const QString &key, const MathResult &r);
    std::optional<MathResult> loadFromDisk(const QString &key);
    void flushResults();

    QProcess *m_proc = nullptr;
    bool m_ready = false;
    bool m_checked = false;
    bool m_available = false;
    QString m_reason;
    QString m_node, m_mathjaxDir, m_fontDir, m_script, m_cacheDir;
    QByteArray m_buffer;
    QList<QByteArray> m_queued; // lines waiting for helper "ready"
    QSet<QString> m_inFlight;
    QHash<QString, MathResult> m_memory;
    bool m_flushScheduled = false;
};

} // namespace mdw
