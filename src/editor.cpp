#include "editor.h"
#include "theme.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QUrl>

namespace mdw {

static QString tr(const char *s) { return QCoreApplication::translate("Editor", s); }

QString editorSettingHint()
{
    QString conf = Theme::configDir() + QStringLiteral("/md-whatever.conf");
    if (conf.startsWith(QDir::homePath() + QLatin1Char('/')))
        conf = QLatin1Char('~') + conf.mid(QDir::homePath().size());
    return tr("Set editor= in %1 (for example editor=kate).").arg(conf);
}

QString editorSetting(const QString &confText)
{
    static const QRegularExpression keyLine(QStringLiteral(R"(^\s*editor\s*=(.*)$)"));
    for (const QString &line : confText.split(QLatin1Char('\n'))) {
        const QString t = line.trimmed();
        if (t.startsWith(QLatin1Char('['))) {
            if (t.compare(QLatin1String("[General]"), Qt::CaseInsensitive) == 0)
                continue;
            break; // another section
        }
        const QRegularExpressionMatch m = keyLine.match(line);
        if (m.hasMatch())
            return m.captured(1).trimmed();
    }
    return QString();
}

EditorCommand commandFromSetting(const QString &setting, const QString &path)
{
    QStringList parts = QProcess::splitCommand(setting);
    if (parts.isEmpty())
        return {QString(), {}, tr("The editor= setting is empty. ") + editorSettingHint()};
    bool placed = false;
    for (QString &p : parts) {
        if (p.contains(QLatin1String("{file}"))) {
            p.replace(QLatin1String("{file}"), path);
            placed = true;
        }
    }
    if (!placed)
        parts << path;
    QString program = parts.takeFirst();
    if (program.startsWith(QLatin1String("~/")))
        program = QDir::homePath() + program.mid(1);
    return {program, parts, QString()};
}

// The desktop entry spec's string escapes (\s \n \t \r \\), applied to the
// whole value before it's split.
static QString unescapeValue(const QString &v)
{
    QString out;
    out.reserve(v.size());
    for (qsizetype i = 0; i < v.size(); ++i) {
        if (v[i] != QLatin1Char('\\') || i + 1 == v.size()) {
            out += v[i];
            continue;
        }
        const QChar c = v[++i];
        switch (c.unicode()) {
        case 's': out += QLatin1Char(' '); break;
        case 'n': out += QLatin1Char('\n'); break;
        case 't': out += QLatin1Char('\t'); break;
        case 'r': out += QLatin1Char('\r'); break;
        case '\\': out += QLatin1Char('\\'); break;
        default: out += QLatin1Char('\\'); out += c; break;
        }
    }
    return out;
}

// Exec's own quoting: spaces separate arguments, "..." quotes one, and inside
// quotes a backslash escapes " ` $ and \.
static QStringList splitExec(const QString &exec)
{
    QStringList args;
    QString cur;
    bool inArg = false, quoted = false;
    for (qsizetype i = 0; i < exec.size(); ++i) {
        const QChar c = exec[i];
        if (quoted) {
            if (c == QLatin1Char('\\') && i + 1 < exec.size())
                cur += exec[++i];
            else if (c == QLatin1Char('"'))
                quoted = false;
            else
                cur += c;
        } else if (c == QLatin1Char('"')) {
            quoted = inArg = true;
        } else if (c.isSpace()) {
            if (inArg)
                args << cur;
            cur.clear();
            inArg = false;
        } else {
            cur += c;
            inArg = true;
        }
    }
    if (inArg)
        args << cur;
    return args;
}

EditorCommand commandFromDesktopEntry(const QString &desktopText, const QString &path)
{
    QString exec, name;
    bool terminal = false, inEntry = false;
    for (const QString &raw : desktopText.split(QLatin1Char('\n'))) {
        const QString line = raw.trimmed();
        if (line.startsWith(QLatin1Char('['))) {
            inEntry = line == QLatin1String("[Desktop Entry]");
            continue;
        }
        if (!inEntry)
            continue;
        const qsizetype eq = line.indexOf(QLatin1Char('='));
        if (eq < 0)
            continue;
        const QString key = line.left(eq).trimmed();
        const QString value = line.mid(eq + 1).trimmed();
        if (key == QLatin1String("Exec"))
            exec = value;
        else if (key == QLatin1String("Name"))
            name = value;
        else if (key == QLatin1String("Terminal"))
            terminal = value == QLatin1String("true");
    }
    if (name.isEmpty())
        name = tr("The default text editor");
    if (exec.isEmpty())
        return {QString(), {}, tr("%1 has no command to run. ").arg(name) + editorSettingHint()};
    if (terminal)
        return {QString(), {}, tr("%1 runs in a terminal. ").arg(name)
                                   + tr("Set editor= in md-whatever.conf to run it in one (for example editor=konsole -e nvim).")};

    const QString url = QUrl::fromLocalFile(path).toString(QUrl::FullyEncoded);
    QStringList args;
    bool placed = false;
    for (const QString &arg : splitExec(unescapeValue(exec))) {
        QString out;
        bool hadCode = false;
        for (qsizetype i = 0; i < arg.size(); ++i) {
            if (arg[i] != QLatin1Char('%') || i + 1 == arg.size()) {
                out += arg[i];
                continue;
            }
            const QChar code = arg[++i];
            if (code == QLatin1Char('%')) {
                out += QLatin1Char('%');
                continue;
            }
            hadCode = true;
            if (code == QLatin1Char('f') || code == QLatin1Char('F')) {
                out += path;
                placed = true;
            } else if (code == QLatin1Char('u') || code == QLatin1Char('U')) {
                out += url;
                placed = true;
            } // %i %c %k and the deprecated ones: dropped
        }
        if (!out.isEmpty() || !hadCode)
            args << out;
    }
    if (args.isEmpty())
        return {QString(), {}, tr("%1 has no command to run. ").arg(name) + editorSettingHint()};
    if (!placed)
        args << path;
    const QString program = args.takeFirst();
    return {program, args, QString()};
}

EditorCommand resolveEditor(const QString &path)
{
    QFile conf(Theme::configDir() + QStringLiteral("/md-whatever.conf"));
    if (conf.open(QIODevice::ReadOnly | QIODevice::Text)) {
        const QString setting = editorSetting(QString::fromUtf8(conf.readAll()));
        if (!setting.isEmpty())
            return commandFromSetting(setting, path);
    }

    const EditorCommand none{QString(), {}, tr("No text editor found. ") + editorSettingHint()};
    QProcess xdg;
    xdg.start(QStringLiteral("xdg-mime"), {QStringLiteral("query"), QStringLiteral("default"), QStringLiteral("text/plain")});
    if (!xdg.waitForFinished(3000) || xdg.exitCode() != 0)
        return none;
    const QString desktop = QString::fromUtf8(xdg.readAllStandardOutput()).trimmed().section(QLatin1Char(';'), 0, 0);
    if (desktop.isEmpty())
        return none;
    if (desktop == QLatin1String("md-whatever.desktop"))
        return {QString(), {}, tr("md-whatever is the default app for text files, and it can't edit. ") + editorSettingHint()};
    const QString file = QStandardPaths::locate(QStandardPaths::ApplicationsLocation, desktop);
    QFile f(file);
    if (file.isEmpty() || !f.open(QIODevice::ReadOnly | QIODevice::Text))
        return none;
    return commandFromDesktopEntry(QString::fromUtf8(f.readAll()), path);
}

} // namespace mdw
