#include "math.h"
#include "timing.h"

#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTimer>

namespace mdw {

static QString dataDir()
{
    const QByteArray env = qgetenv("MDW_DATA_DIR");
    if (!env.isEmpty())
        return QString::fromLocal8Bit(env);
    return QDir::cleanPath(QCoreApplication::applicationDirPath() + QStringLiteral("/../share/md-whatever"));
}

MathRenderer &MathRenderer::instance()
{
    static MathRenderer r;
    return r;
}

MathRenderer::MathRenderer()
{
    m_cacheDir = QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation) + QStringLiteral("/md-whatever/math");
}

QString MathRenderer::keyFor(const QString &tex, bool display)
{
    // Bump the version prefix when the helper's output format changes.
    const QByteArray in = QByteArrayLiteral("v3|") + (display ? "D|" : "I|") + tex.toUtf8();
    return QString::fromLatin1(QCryptographicHash::hash(in, QCryptographicHash::Sha1).toHex());
}

bool MathRenderer::available()
{
    if (m_checked)
        return m_available;
    m_checked = true;
    const QString dir = dataDir();
    m_script = dir + QStringLiteral("/mathjax-helper.cjs");
    m_fontDir = dir + QStringLiteral("/mathjax-newcm-font");
    m_mathjaxDir = QStringLiteral("/usr/share/mathjax");
    // Prefer the system node: launches from Dolphin don't see nvm's PATH.
    m_node = QFileInfo(QStringLiteral("/usr/bin/node")).isExecutable()
        ? QStringLiteral("/usr/bin/node")
        : QStandardPaths::findExecutable(QStringLiteral("node"));
    if (m_node.isEmpty())
        m_reason = QStringLiteral("node was not found (install the nodejs package)");
    else if (!QFile::exists(m_mathjaxDir + QStringLiteral("/tex-svg.js")))
        m_reason = QStringLiteral("MathJax was not found in /usr/share/mathjax (install the mathjax package)");
    else if (!QFile::exists(m_script))
        m_reason = QStringLiteral("mathjax-helper.cjs is missing from ") + dir;
    else if (!QFileInfo(m_fontDir + QStringLiteral("/svg/dynamic")).isDir())
        m_reason = QStringLiteral("MathJax font data is missing from ") + m_fontDir;
    m_available = m_reason.isEmpty();
    return m_available;
}

// MathJax's boxes can be slightly too tight (browsers draw outside them,
// Qt's SVG renderer clips), so every equation gets a small transparent margin.
// Units are MathJax's: 1000 = 1 em.
static constexpr double kPadX = 40, kPadY = 120;

static bool viewBox(const QByteArray &svg, double v[4])
{
    static const QRegularExpression vb(QStringLiteral(R"re(viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)")re"));
    const auto m = vb.match(QString::fromUtf8(svg.left(600)));
    if (!m.hasMatch())
        return false;
    for (int i = 0; i < 4; ++i)
        v[i] = m.captured(i + 1).toDouble();
    return true;
}

static void parseGeometry(MathResult &r)
{
    double v[4];
    if (!viewBox(r.svg, v))
        return;
    const double minY = v[1] - kPadY, w = v[2] + 2 * kPadX, h = v[3] + 2 * kPadY;
    r.widthEm = w / 1000.0;
    r.heightEm = h / 1000.0;
    r.depthEm = (minY + h) / 1000.0; // part below the baseline
}

std::optional<MathResult> MathRenderer::loadFromDisk(const QString &key)
{
    QFile svg(m_cacheDir + QLatin1Char('/') + key + QStringLiteral(".svg"));
    if (svg.open(QIODevice::ReadOnly)) {
        MathResult r;
        r.svg = svg.readAll();
        parseGeometry(r);
        return r;
    }
    QFile err(m_cacheDir + QLatin1Char('/') + key + QStringLiteral(".err"));
    if (err.open(QIODevice::ReadOnly)) {
        MathResult r;
        r.error = true;
        r.message = QString::fromUtf8(err.readAll());
        return r;
    }
    return std::nullopt;
}

std::optional<MathResult> MathRenderer::lookup(const QString &key)
{
    auto it = m_memory.constFind(key);
    if (it != m_memory.constEnd())
        return *it;
    if (auto r = loadFromDisk(key)) {
        m_memory.insert(key, *r);
        return r;
    }
    return std::nullopt;
}

void MathRenderer::store(const QString &key, const MathResult &r)
{
    m_memory.insert(key, r);
    QDir().mkpath(m_cacheDir);
    QFile f(m_cacheDir + QLatin1Char('/') + key + (r.error ? QStringLiteral(".err") : QStringLiteral(".svg")));
    if (f.open(QIODevice::WriteOnly))
        f.write(r.error ? r.message.toUtf8() : r.svg);
}

void MathRenderer::startHelper()
{
    if (m_proc)
        return;
    timing::mark("math: starting helper");
    m_proc = new QProcess(this);
    m_proc->setProcessChannelMode(timing::enabled() ? QProcess::ForwardedErrorChannel : QProcess::SeparateChannels);
    if (!timing::enabled())
        m_proc->setStandardErrorFile(QProcess::nullDevice());
    connect(m_proc, &QProcess::readyReadStandardOutput, this, &MathRenderer::onReadyRead);
    auto die = [this] {
        if (!m_proc)
            return;
        m_proc->deleteLater();
        m_proc = nullptr;
        m_ready = false;
        m_available = false;
        m_reason = QStringLiteral("the math helper stopped unexpectedly");
        m_inFlight.clear();
        m_queued.clear();
        emit failed();
    };
    connect(m_proc, &QProcess::errorOccurred, this, die);
    connect(m_proc, &QProcess::finished, this, die);
    m_proc->start(m_node, {m_script, m_mathjaxDir, m_fontDir});
}

void MathRenderer::request(const QList<MathRequest> &reqs)
{
    if (!available()) {
        emit failed();
        return;
    }
    bool any = false;
    for (const MathRequest &r : reqs) {
        if (m_inFlight.contains(r.key) || lookup(r.key))
            continue;
        m_inFlight.insert(r.key);
        QJsonObject o{{QStringLiteral("id"), r.key}, {QStringLiteral("tex"), r.tex}, {QStringLiteral("display"), r.display}};
        QByteArray line = QJsonDocument(o).toJson(QJsonDocument::Compact) + '\n';
        if (m_ready)
            m_proc->write(line);
        else
            m_queued.append(line);
        any = true;
    }
    if (any)
        startHelper();
    else if (m_inFlight.isEmpty())
        QTimer::singleShot(0, this, &MathRenderer::resultsReady); // everything was cached already
}

void MathRenderer::onReadyRead()
{
    m_buffer += m_proc->readAllStandardOutput();
    qsizetype nl;
    bool gotResults = false;
    while ((nl = m_buffer.indexOf('\n')) >= 0) {
        const QByteArray line = m_buffer.left(nl);
        m_buffer.remove(0, nl + 1);
        const QJsonObject o = QJsonDocument::fromJson(line).object();
        if (o.value(QStringLiteral("ready")).toBool()) {
            timing::mark("math: helper ready");
            m_ready = true;
            for (const QByteArray &q : std::as_const(m_queued))
                m_proc->write(q);
            m_queued.clear();
            continue;
        }
        const QString id = o.value(QStringLiteral("id")).toString();
        if (id.isEmpty())
            continue;
        MathResult r;
        if (o.contains(QStringLiteral("error"))) {
            r.error = true;
            r.message = o.value(QStringLiteral("error")).toString();
        } else {
            r.svg = o.value(QStringLiteral("svg")).toString().toUtf8();
            parseGeometry(r);
        }
        store(id, r);
        m_inFlight.remove(id);
        gotResults = true;
    }
    if (gotResults && m_inFlight.isEmpty()) {
        timing::mark("math: batch done");
        emit resultsReady();
    }
}

QByteArray MathRenderer::svgForDisplay(const QString &key, const QColor &color, double pxPerEm)
{
    auto r = lookup(key);
    if (!r || r->error)
        return {};
    QByteArray svg = r->svg;
    svg.replace("currentColor", color.name().toLatin1());
    // Replace the ex-based size on the root <svg> with device pixels.
    const qsizetype tagEnd = svg.indexOf('>');
    QByteArray head = svg.left(tagEnd);
    static const QRegularExpression size(QStringLiteral(R"( (width|height)="[^"]*")"));
    static const QRegularExpression style(QStringLiteral(R"( style="[^"]*")"));
    QString h = QString::fromUtf8(head);
    h.remove(size).remove(style);
    double v[4];
    if (viewBox(svg, v)) {
        static const QRegularExpression vbAttr(QStringLiteral(R"re( viewBox="[^"]*")re"));
        h.remove(vbAttr);
        h += QStringLiteral(" viewBox=\"%1 %2 %3 %4\"")
                 .arg(v[0] - kPadX).arg(v[1] - kPadY).arg(v[2] + 2 * kPadX).arg(v[3] + 2 * kPadY);
    }
    h += QStringLiteral(" width=\"%1\" height=\"%2\"")
             .arg(qMax(1.0, r->widthEm * pxPerEm), 0, 'f', 1)
             .arg(qMax(1.0, r->heightEm * pxPerEm), 0, 'f', 1);
    return h.toUtf8() + svg.mid(tagEnd);
}

} // namespace mdw
