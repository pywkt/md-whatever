#include "theme.h"

#include <QDir>
#include <QFile>
#include <QFontDatabase>
#include <QFontInfo>
#include <QGuiApplication>
#include <QRegularExpression>
#include <QSettings>
#include <QStandardPaths>

namespace mdw {

static QString readFile(const QString &path)
{
    QFile f(path);
    return f.open(QIODevice::ReadOnly) ? QString::fromUtf8(f.readAll()) : QString();
}

static const QStringList kBuiltin = {QStringLiteral("default"), QStringLiteral("paper")};

QString Theme::configDir()
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/md-whatever");
}

bool Theme::isDark(const QPalette &p)
{
    return p.color(QPalette::Base).lightness() < 128;
}

QStringList Theme::available()
{
    QStringList names = kBuiltin;
    const QStringList user = QDir(configDir() + QStringLiteral("/themes")).entryList({QStringLiteral("*.css")}, QDir::Files);
    for (const QString &f : user) {
        const QString n = f.chopped(4);
        if (!names.contains(n))
            names << n;
    }
    return names;
}

void Theme::load(const QString &cliTheme)
{
    QSettings conf(configDir() + QStringLiteral("/md-whatever.conf"), QSettings::IniFormat);
    m_name = cliTheme.isEmpty() ? conf.value(QStringLiteral("theme"), QStringLiteral("default")).toString() : cliTheme;
    m_codeTheme = conf.value(QStringLiteral("code-theme")).toString();
    const QString appearance = conf.value(QStringLiteral("appearance")).toString().trimmed().toLower();
    m_appearance = appearance == QLatin1String("light") ? Appearance::Light
                 : appearance == QLatin1String("dark")  ? Appearance::Dark
                                                        : Appearance::System;
    m_warning.clear();

    // A user theme with a built-in's name replaces the built-in.
    const QString userPath = configDir() + QStringLiteral("/themes/") + m_name + QStringLiteral(".css");
    if (QFile::exists(userPath)) {
        m_themePath = userPath;
        m_themeCss = readFile(userPath);
    } else if (kBuiltin.contains(m_name)) {
        m_themePath.clear();
        m_themeCss = readFile(QStringLiteral(":/themes/") + m_name + QStringLiteral(".css"));
    } else {
        m_warning = QStringLiteral("Theme \"%1\" not found; using default. Available: %2")
                        .arg(m_name, available().join(QStringLiteral(", ")));
        m_name = QStringLiteral("default");
        m_themePath.clear();
        m_themeCss = readFile(QStringLiteral(":/themes/default.css"));
    }
    // Every theme gets the shared structural rules first.
    m_themeCss = readFile(QStringLiteral(":/themes/base.css")) + QLatin1Char('\n') + m_themeCss;
    m_userCss = readFile(configDir() + QStringLiteral("/user.css"));
}

QString Theme::appearanceName(Appearance a)
{
    switch (a) {
    case Appearance::Light: return QStringLiteral("light");
    case Appearance::Dark: return QStringLiteral("dark");
    case Appearance::System: break;
    }
    return QStringLiteral("system");
}

QPalette Theme::effectivePalette(const QPalette &system) const
{
    const bool systemDark = isDark(system);
    if (m_appearance == Appearance::System || (m_appearance == Appearance::Dark) == systemDark)
        return system;
    // Breeze Light / Breeze Dark (Plasma 6) colors.
    struct Colors { QRgb window, base, alt, text, button, link, visited; };
    static const Colors light{0xeff0f1, 0xffffff, 0xf7f7f7, 0x232629, 0xfcfcfc, 0x2980b9, 0x9b59b6};
    static const Colors dark{0x202326, 0x141618, 0x1d1f22, 0xfcfcfc, 0x292c30, 0x1d99f3, 0x9b59b6};
    const Colors &c = m_appearance == Appearance::Dark ? dark : light;
    QPalette p = system; // keeps the accent (Highlight) and anything not set here
    for (QPalette::ColorGroup g : {QPalette::Active, QPalette::Inactive, QPalette::Disabled}) {
        p.setColor(g, QPalette::Window, QColor(c.window));
        p.setColor(g, QPalette::WindowText, QColor(c.text));
        p.setColor(g, QPalette::Base, QColor(c.base));
        p.setColor(g, QPalette::AlternateBase, QColor(c.alt));
        p.setColor(g, QPalette::Text, QColor(c.text));
        p.setColor(g, QPalette::Button, QColor(c.button));
        p.setColor(g, QPalette::ButtonText, QColor(c.text));
        p.setColor(g, QPalette::Link, QColor(c.link));
        p.setColor(g, QPalette::LinkVisited, QColor(c.visited));
    }
    return p;
}

bool Theme::saveSetting(const QString &key, const QString &value)
{
    // Edit the text rather than rewriting it with QSettings, which would drop
    // the user's comments and ordering. Top-level keys and [General] are the
    // same section to QSettings, so a KEY= line anywhere before another
    // section header is the one that counts.
    const QString path = configDir() + QStringLiteral("/md-whatever.conf");
    QStringList lines;
    QFile in(path);
    if (in.open(QIODevice::ReadOnly | QIODevice::Text))
        lines = QString::fromUtf8(in.readAll()).split(QLatin1Char('\n'));
    in.close();
    if (!lines.isEmpty() && lines.last().isEmpty())
        lines.removeLast();

    const QRegularExpression keyLine(QStringLiteral(R"(^\s*%1\s*=)").arg(QRegularExpression::escape(key)));
    const QString newLine = key + QLatin1Char('=') + value;
    int insertAt = 0;
    bool done = false;
    for (int i = 0; i < lines.size() && !done; ++i) {
        const QString t = lines[i].trimmed();
        if (t.startsWith(QLatin1Char('['))) {
            if (t.compare(QLatin1String("[General]"), Qt::CaseInsensitive) == 0) {
                insertAt = i + 1;
                continue;
            }
            break; // another section: keys after this aren't ours
        }
        if (keyLine.match(lines[i]).hasMatch()) {
            lines[i] = newLine;
            done = true;
        }
    }
    if (!done)
        lines.insert(insertAt, newLine);

    QDir().mkpath(configDir());
    QFile out(path);
    if (!out.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text))
        return false;
    out.write((lines.join(QLatin1Char('\n')) + QLatin1Char('\n')).toUtf8());
    return out.flush();
}

QStringList Theme::watchedFiles() const
{
    QStringList files{configDir() + QStringLiteral("/user.css"), configDir() + QStringLiteral("/md-whatever.conf")};
    if (!m_themePath.isEmpty())
        files << m_themePath;
    return files;
}

static QColor mix(const QColor &a, const QColor &b, double t)
{
    return QColor::fromRgbF(float(a.redF() + (b.redF() - a.redF()) * t),
                            float(a.greenF() + (b.greenF() - a.greenF()) * t),
                            float(a.blueF() + (b.blueF() - a.blueF()) * t));
}

static QString quoted(const QString &family)
{
    QString f = family;
    f.remove(QLatin1Char('"'));
    return QLatin1Char('"') + f + QLatin1Char('"');
}

double Theme::basePx()
{
    // Reading text a bit larger than UI text: 10pt UI font -> 16px.
    const double uiPx = QFontInfo(QGuiApplication::font()).pixelSize();
    return qRound(qMax(14.0, uiPx * 1.2));
}

QString Theme::css(const QPalette &p, bool dark) const
{
    const QColor bg = p.color(QPalette::Base);
    const QColor text = p.color(QPalette::Text);
    const QColor accent = p.color(QPalette::Highlight);
    QColor link = p.color(QPalette::Link);
    if (dark && link.lightness() < 110)
        link = link.lighter(160); // some palettes keep a dark link color in dark mode

    const QFont body = QGuiApplication::font();
    const QFont mono = QFontDatabase::systemFont(QFontDatabase::FixedFont);

    struct Var { const char *name; QString value; };
    const Var vars[] = {
        {"bg", bg.name()},
        {"text", text.name()},
        {"muted", mix(bg, text, 0.62).name()},
        {"faint", mix(bg, text, 0.40).name()},
        {"rule", mix(bg, text, dark ? 0.22 : 0.14).name()},
        {"code-bg", mix(bg, text, dark ? 0.07 : 0.045).name()},
        {"code-border", mix(bg, text, dark ? 0.14 : 0.09).name()},
        {"quote-bg", mix(bg, accent, dark ? 0.10 : 0.06).name()},
        {"table-head", mix(bg, text, dark ? 0.09 : 0.05).name()},
        {"table-stripe", mix(bg, text, dark ? 0.04 : 0.022).name()},
        {"link", link.name()},
        {"accent", accent.name()},
        {"accent-text", p.color(QPalette::HighlightedText).name()},
        {"error", (dark ? QColor(0xff, 0x7b, 0x72) : QColor(0xc6, 0x28, 0x28)).name()},
        {"body-font", quoted(body.family())},
        {"mono-font", quoted(mono.family())},
        {"base-size", QString::number(basePx()) + QStringLiteral("px")},
    };
    QString out = QStringLiteral(":root {\n");
    for (const Var &v : vars)
        out += QStringLiteral("  --%1: %2;\n").arg(QLatin1String(v.name), v.value);
    out += QStringLiteral("}\n");
    out += m_themeCss;
    out += QLatin1Char('\n');
    out += m_userCss;
    return out;
}

QColor Theme::textColor(const QPalette &p, bool dark) const
{
    // Math images can't inherit CSS color, so find the --text value the
    // cascade would pick: last matching declaration wins, and rules whose
    // selector mentions .dark/.light only apply in that mode.
    static const QRegularExpression rule(QStringLiteral(R"(([^{}]*)\{([^{}]*)\})"));
    static const QRegularExpression decl(QStringLiteral(R"(--text\s*:\s*([^;}\s]+))"));
    QColor c = p.color(QPalette::Text);
    for (const QString *css : {&m_themeCss, &m_userCss}) {
        auto rules = rule.globalMatch(*css);
        while (rules.hasNext()) {
            const auto m = rules.next();
            const QString selector = m.captured(1);
            if ((selector.contains(QLatin1String(".dark")) && !dark)
                || (selector.contains(QLatin1String(".light")) && dark))
                continue;
            auto decls = decl.globalMatch(m.captured(2));
            while (decls.hasNext()) {
                const QColor candidate = QColor::fromString(decls.next().captured(1));
                if (candidate.isValid())
                    c = candidate;
            }
        }
    }
    return c;
}

} // namespace mdw
