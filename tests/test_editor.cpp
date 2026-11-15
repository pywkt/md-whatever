// The "Edit" command: editor= settings and .desktop Exec lines turned into a
// program and arguments. Pure functions; nothing is launched.
#include "editor.h"

#include <QDir>
#include <QTest>

using namespace mdw;

class TestEditor : public QObject
{
    Q_OBJECT

    static QStringList all(const EditorCommand &c) { return QStringList{c.program} + c.args; }

private slots:
    void settingLine()
    {
        QCOMPARE(editorSetting(QStringLiteral("theme=paper\neditor=kate\n")), QStringLiteral("kate"));
        QCOMPARE(editorSetting(QStringLiteral("[General]\n  editor = code -g {file}:1 \n")), QStringLiteral("code -g {file}:1"));
        // as written: QSettings would split at the comma and drop the quotes
        QCOMPARE(editorSetting(QStringLiteral("editor=\"/opt/My Editor/ed\" --x=a,b\n")),
                 QStringLiteral("\"/opt/My Editor/ed\" --x=a,b"));
        QCOMPARE(editorSetting(QStringLiteral("theme=paper\n")), QString());
        QCOMPARE(editorSetting(QStringLiteral("[Other]\neditor=kate\n")), QString()); // not our section
        QCOMPARE(editorSetting(QStringLiteral("editor=kate\neditor=vim\n")), QStringLiteral("kate")); // first, like saveSetting
    }

    void fromSetting()
    {
        const QString p = QStringLiteral("/home/u/notes.md");
        QCOMPARE(all(commandFromSetting(QStringLiteral("kate"), p)), (QStringList{"kate", p}));
        QCOMPARE(all(commandFromSetting(QStringLiteral("code -g {file}:1"), p)), (QStringList{"code", "-g", p + ":1"}));
        QCOMPARE(all(commandFromSetting(QStringLiteral("konsole -e nvim {file}"), p)), (QStringList{"konsole", "-e", "nvim", p}));
        QCOMPARE(all(commandFromSetting(QStringLiteral("\"/opt/My Editor/ed\" --new"), p)), (QStringList{"/opt/My Editor/ed", "--new", p}));
        QCOMPARE(commandFromSetting(QStringLiteral("~/bin/ed"), p).program, QDir::homePath() + QStringLiteral("/bin/ed"));

        // A path with spaces and quotes stays one argument, never re-parsed.
        const QString odd = QStringLiteral("/tmp/my \"odd\" file's.md");
        QCOMPARE(all(commandFromSetting(QStringLiteral("kate"), odd)), (QStringList{"kate", odd}));
        QCOMPARE(all(commandFromSetting(QStringLiteral("ed {file}"), odd)), (QStringList{"ed", odd}));

        QVERIFY(!commandFromSetting(QStringLiteral("   "), p).error.isEmpty());
        QVERIFY(commandFromSetting(QStringLiteral("kate"), p).error.isEmpty());
    }

    void fromDesktopEntry()
    {
        const QString p = QStringLiteral("/home/u/my notes.md");
        const QString url = QStringLiteral("file:///home/u/my%20notes.md");
        auto entry = [](const QString &body) { return QStringLiteral("[Desktop Entry]\nName=Ed\nType=Application\n") + body; };

        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=kate -b %U\n"), p)), (QStringList{"kate", "-b", url}));
        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=gedit %f\n"), p)), (QStringList{"gedit", p}));
        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=ed %F\n"), p)), (QStringList{"ed", p}));
        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=ed %u\n"), p)), (QStringList{"ed", url}));
        // %i %c %k dropped, %% is a percent sign
        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=ed %i --title=%c %k --pct=100%% %f\n"), p)),
                 (QStringList{"ed", "--title=", "--pct=100%", p}));
        // no field code: the path goes last
        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=ed --new-window\n"), p)), (QStringList{"ed", "--new-window", p}));
        // the spec's quoting: "..." with \" \` \$ \\ escapes; \s is a space (separating, unless quoted)
        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=\"/opt/My Ed/ed\" \"a \\\\\"b\\\\\"\" \"x\\sy\" x\\sy %f\n"), p)),
                 (QStringList{"/opt/My Ed/ed", "a \"b\"", "x y", "x", "y", p}));
        // Flatpak: the @@ markers are ordinary arguments
        QCOMPARE(all(commandFromDesktopEntry(entry("Exec=/usr/bin/flatpak run --command=ed org.x.Ed @@u %U @@\n"), p)),
                 (QStringList{"/usr/bin/flatpak", "run", "--command=ed", "org.x.Ed", "@@u", url, "@@"}));

        // Exec from another group is ignored; ours wins whichever comes first
        QCOMPARE(all(commandFromDesktopEntry(QStringLiteral("[Desktop Action new]\nExec=wrong %f\n[Desktop Entry]\nExec=right %f\n"), p)),
                 (QStringList{"right", p}));
        QVERIFY(!commandFromDesktopEntry(QStringLiteral("[Desktop Action new]\nExec=other %f\n"), p).error.isEmpty());

        const EditorCommand term = commandFromDesktopEntry(entry("Exec=nvim %F\nTerminal=true\n"), p);
        QVERIFY(term.program.isEmpty());
        QVERIFY(term.error.contains(QLatin1String("Ed runs in a terminal")));
        QVERIFY(!commandFromDesktopEntry(entry("Exec=\n"), p).error.isEmpty());
        QVERIFY(!commandFromDesktopEntry(entry("Exec=%i\n"), p).error.isEmpty());
    }
};

QTEST_GUILESS_MAIN(TestEditor)
#include "test_editor.moc"
