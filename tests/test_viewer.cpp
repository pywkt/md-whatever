// End-to-end tests of the window: keys, find, links, history, live reload,
// palette and theme following, math. Runs offscreen with a throwaway config.
#include "findbar.h"
#include "mainwindow.h"
#include "noticebar.h"
#include "viewer.h"

#include <QApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLineEdit>
#include <QMenu>
#include <QRandomGenerator>
#include <QScrollBar>
#include <QSignalSpy>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QTest>

using namespace mdw;

static const QString kFixtures = QStringLiteral(MDW_FIXTURES);

static void writeAtomically(const QString &path, const QByteArray &data)
{
    // what most editors do: write a temp file, then rename it over the original
    const QString tmp = path + QStringLiteral(".tmp~");
    QFile f(tmp);
    QVERIFY(f.open(QIODevice::WriteOnly));
    f.write(data);
    f.close();
    QFile::remove(path);
    QVERIFY(QFile::rename(tmp, path));
}

class TestViewer : public QObject
{
    Q_OBJECT

    AppContext *ctx = nullptr;

    MainWindow *open(const QString &path)
    {
        auto *w = new MainWindow(*ctx);
        w->resize(900, 700);
        w->openFile(path);
        w->show();
        if (!QTest::qWaitForWindowExposed(w))
            qWarning("window not exposed");
        w->activateWindow();
        if (!QTest::qWaitForWindowActive(w))
            qWarning("window not active");
        return w;
    }
    static Viewer *viewer(MainWindow *w) { return w->findChild<Viewer *>(); }

private slots:
    void initTestCase()
    {
        Q_INIT_RESOURCE(resources);
        QStandardPaths::setTestModeEnabled(true); // config + cache under ~/.qttest
        const QString config = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation);
        QDir(config + QStringLiteral("/md-whatever")).removeRecursively();
        QDir().mkpath(config); // like ~/.config, which always exists
        ctx = new AppContext(QString());
    }

    void opensAndTitles()
    {
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        QCOMPARE(w->windowTitle(), QStringLiteral("kitchen-sink.md — md-whatever"));
        QVERIFY(w->currentHtml().contains(QLatin1String("<h1 id=\"kitchen-sink\">")));
        QVERIFY(!w->currentHtml().contains(QLatin1String("title: Kitchen sink"))); // front matter hidden
        delete w;
    }

    void scrollKeys()
    {
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        Viewer *v = viewer(w);
        v->setFocus();
        QCOMPARE(v->scrollY(), 0);
        QTest::keyClick(v, Qt::Key_J);
        const int afterJ = v->scrollY();
        QVERIFY(afterJ > 0);
        QTest::keyClick(v, Qt::Key_K);
        QCOMPARE(v->scrollY(), 0);
        QTest::keyClick(v, Qt::Key_Space);
        QVERIFY(v->scrollY() > afterJ * 3);
        QTest::keyClick(v, Qt::Key_G, Qt::ShiftModifier);
        QCOMPARE(v->scrollY(), v->verticalScrollBar()->maximum());
        QTest::keyClick(v, Qt::Key_G);
        QCOMPARE(v->scrollY(), 0);
        delete w;
    }

    void inDocumentAnchorAndBack()
    {
        const QString path = kFixtures + QStringLiteral("/kitchen-sink.md");
        MainWindow *w = open(path);
        Viewer *v = viewer(w);
        QUrl anchor = QUrl::fromLocalFile(path);
        anchor.setFragment(QStringLiteral("tables"));
        emit v->linkClicked(anchor);
        QTRY_VERIFY(v->scrollY() > 0);
        QTest::keyClick(w, Qt::Key_Left, Qt::AltModifier);
        QTRY_COMPARE(v->scrollY(), 0);
        QTest::keyClick(w, Qt::Key_Right, Qt::AltModifier);
        QTRY_VERIFY(v->scrollY() > 0);
        delete w;
    }

    void linkToOtherFileAndBack()
    {
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        Viewer *v = viewer(w);
        emit v->linkClicked(QUrl(QStringLiteral("readme.md"))); // relative, as litehtml reports it
        QTRY_COMPARE(w->windowTitle(), QStringLiteral("readme.md — md-whatever"));
        QTest::keyClick(w, Qt::Key_Left, Qt::AltModifier);
        QTRY_COMPARE(w->windowTitle(), QStringLiteral("kitchen-sink.md — md-whatever"));
        // link with an anchor into another file
        emit v->linkClicked(QUrl(QStringLiteral("math.md#display-math")));
        QTRY_COMPARE(w->windowTitle(), QStringLiteral("math.md — md-whatever"));
        QTRY_VERIFY(v->scrollY() > 0);
        delete w;
    }

    void findBar()
    {
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        Viewer *v = viewer(w);
        auto *bar = w->findChild<FindBar *>();
        QVERIFY(!bar->isVisible());
        v->setFocus();
        QTest::keyClick(v, Qt::Key_Slash);
        QTRY_VERIFY(bar->isVisible());
        auto *edit = bar->findChild<QLineEdit *>();
        QTRY_VERIFY(edit->hasFocus());
        QTest::keyClicks(edit, QStringLiteral("Below the rule"));
        QTRY_VERIFY(v->scrollY() > 0); // incremental search scrolled to the match
        QVERIFY(!v->selectedText().isEmpty());
        QTest::keyClick(edit, Qt::Key_Escape);
        QTRY_VERIFY(!bar->isVisible());
        delete w;
    }

    void liveReloadKeepsScroll()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath(QStringLiteral("doc.md"));
        QByteArray body;
        for (int i = 0; i < 200; ++i)
            body += "Paragraph " + QByteArray::number(i) + " with some words to fill the line.\n\n";
        writeAtomically(path, "# Version one\n\n" + body);
        MainWindow *w = open(path);
        Viewer *v = viewer(w);
        v->setScrollRatio(0.5);
        const int before = v->scrollY();
        QVERIFY(before > 0);

        writeAtomically(path, "# Version two\n\n" + body);
        QTRY_VERIFY_WITH_TIMEOUT(w->currentHtml().contains(QLatin1String("Version two")), 3000);
        QVERIFY(qAbs(v->scrollY() - before) < 40);

        // the watch must survive the atomic replace: save again
        writeAtomically(path, "# Version three\n\n" + body);
        QTRY_VERIFY_WITH_TIMEOUT(w->currentHtml().contains(QLatin1String("Version three")), 3000);

        // deleted file shows an error document, re-created file comes back
        QFile::remove(path);
        QTRY_VERIFY_WITH_TIMEOUT(w->currentHtml().contains(QLatin1String("File not found")), 3000);
        writeAtomically(path, "# Back again\n");
        QTRY_VERIFY_WITH_TIMEOUT(w->currentHtml().contains(QLatin1String("Back again")), 3000);
        delete w;
    }

    void followsPaletteLive()
    {
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        const QPalette original = QApplication::palette();
        QPalette dark;
        dark.setColor(QPalette::Base, QColor(0x20, 0x20, 0x24));
        dark.setColor(QPalette::Text, QColor(0xee, 0xee, 0xee));
        dark.setColor(QPalette::Window, QColor(0x20, 0x20, 0x24));
        QApplication::setPalette(dark);
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("<html class=\"dark\">")));
        QVERIFY(w->currentHtml().contains(QLatin1String("--bg: #202024")));
        QPalette light;
        light.setColor(QPalette::Base, Qt::white);
        light.setColor(QPalette::Text, Qt::black);
        QApplication::setPalette(light);
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("<html class=\"light\">")));
        QApplication::setPalette(original);
        delete w;
    }

    void userCssRestylesLive()
    {
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        const QString conf = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/md-whatever");
        QVERIFY(!QFileInfo::exists(conf)); // the config dir appears while the app runs
        QDir().mkpath(conf);
        QTest::qWait(300); // let the watcher pick up the new directory
        writeAtomically(conf + QStringLiteral("/user.css"), ":root { --link: #123456; }\n");
        QTRY_VERIFY_WITH_TIMEOUT(w->currentHtml().contains(QLatin1String("--link: #123456")), 3000);
        writeAtomically(conf + QStringLiteral("/user.css"), ":root { --link: #654321; }\n");
        QTRY_VERIFY_WITH_TIMEOUT(w->currentHtml().contains(QLatin1String("--link: #654321")), 3000);
        QFile::remove(conf + QStringLiteral("/user.css"));
        delete w;
    }

    void mathRendersAfterFirstPaint()
    {
        if (!MathRenderer::instance().available())
            QSKIP("math helper unavailable");
        MainWindow *w = open(kFixtures + QStringLiteral("/math.md"));
        QTRY_VERIFY_WITH_TIMEOUT(w->currentHtml().contains(QLatin1String("mdw-math:")), 10000);
        QTRY_VERIFY_WITH_TIMEOUT(!w->mathPending(), 10000);
        QVERIFY(w->currentHtml().contains(QLatin1String("class=\"math-error\""))); // the broken \frac
        QVERIFY(!w->currentHtml().contains(QLatin1String("class=\"math-pending\"")));
        delete w;
    }

    void mathAfterFollowingLink()
    {
        // A followed link opens the new file in a window that has already
        // painted, so its math must be requested then, not on first paint.
        if (!MathRenderer::instance().available())
            QSKIP("math helper unavailable");
        QTemporaryDir dir;
        // Unique TeX so a cache left over from an earlier run can't make this pass.
        const QByteArray tex = "x_{" + QByteArray::number(QRandomGenerator::global()->generate()) + "} + \\sqrt{2}";
        writeAtomically(dir.filePath(QStringLiteral("a.md")), "# A\n\n[to b](b.md)\n");
        writeAtomically(dir.filePath(QStringLiteral("b.md")), "# B\n\n$$" + tex + "$$\n");
        MainWindow *w = open(dir.filePath(QStringLiteral("a.md")));
        QTRY_VERIFY(!w->mathPending()); // a.md has no math; first paint is done
        emit viewer(w)->linkClicked(QUrl(QStringLiteral("b.md")));
        QTRY_COMPARE(w->windowTitle(), QStringLiteral("b.md — md-whatever"));
        QTRY_VERIFY_WITH_TIMEOUT(!w->mathPending(), 10000);
        QVERIFY(w->currentHtml().contains(QLatin1String("mdw-math:")));
        delete w;
    }

    void errorDocuments()
    {
        MainWindow *w = open(QStringLiteral("/nonexistent/nope.md"));
        QVERIFY(w->currentHtml().contains(QLatin1String("File not found")));
        delete w;
        w = open(kFixtures + QStringLiteral("/not-utf8.md"));
        QVERIFY(w->currentHtml().contains(QLatin1String("not valid UTF-8")));
        QVERIFY(w->currentHtml().contains(QStringLiteral("Café")));
        delete w;
        w = open(kFixtures + QStringLiteral("/empty.md"));
        QVERIFY(w->currentHtml().contains(QLatin1String("This file is empty")));
        delete w;
    }

    void zoomKeys()
    {
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        Viewer *v = viewer(w);
        QCOMPARE(v->zoomFactor(), 1.0);
        QTest::keyClick(w, Qt::Key_Equal, Qt::ControlModifier);
        QVERIFY(v->zoomFactor() > 1.05);
        QTest::keyClick(w, Qt::Key_0, Qt::ControlModifier); // back to 100%
        QCOMPARE(v->zoomFactor(), 1.0);
        QTest::keyClick(w, Qt::Key_Plus, Qt::ControlModifier);
        QVERIFY(v->zoomFactor() > 1.05);
        QTest::keyClick(w, Qt::Key_Minus, Qt::ControlModifier);
        QCOMPARE(v->zoomFactor(), 1.0);
        QTest::keyClick(w, Qt::Key_Minus, Qt::ControlModifier);
        QVERIFY(v->zoomFactor() < 0.95);
        QTest::keyClick(w, Qt::Key_0, Qt::ControlModifier);
        QCOMPARE(v->zoomFactor(), 1.0);
        delete w;
    }

    void themeMenuSwitchesAndRemembers()
    {
        const QString conf = Theme::configDir() + QStringLiteral("/md-whatever.conf");
        QDir().mkpath(Theme::configDir());
        writeAtomically(conf, "# my settings\ncode-theme=Nord\n");
        QTest::qWait(250); // let the conf watcher settle

        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        auto themeAction = [w](const QString &name) -> QAction * {
            QMenu *menu = w->createContextMenu();
            menu->deleteLater();
            for (QAction *a : menu->actions())
                if (a->menu() && a->text().remove(QLatin1Char('&')) == QLatin1String("Theme"))
                    for (QAction *t : a->menu()->actions())
                        if (t->text().remove(QLatin1Char('&')) == name)
                            return t;
            return nullptr;
        };

        QAction *paper = themeAction(QStringLiteral("paper"));
        QVERIFY(paper);
        QVERIFY(!paper->isChecked());
        QVERIFY(themeAction(QStringLiteral("default"))->isChecked());
        paper->trigger();
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("\"Noto Serif\"")));
        QVERIFY(themeAction(QStringLiteral("paper"))->isChecked());

        auto readConf = [&conf] {
            QFile f(conf);
            return f.open(QIODevice::ReadOnly) ? QString::fromUtf8(f.readAll()) : QString();
        };
        QCOMPARE(readConf(), QStringLiteral("theme=paper\n# my settings\ncode-theme=Nord\n"));

        themeAction(QStringLiteral("default"))->trigger();
        QTRY_VERIFY(!w->currentHtml().contains(QLatin1String("\"Noto Serif\"")));
        QCOMPARE(readConf(), QStringLiteral("theme=default\n# my settings\ncode-theme=Nord\n"));

        delete w;
        QFile::remove(conf);
    }

    void forcedLightAndDark()
    {
        const QString conf = Theme::configDir() + QStringLiteral("/md-whatever.conf");
        const QPalette original = QApplication::palette();
        QPalette dark;
        dark.setColor(QPalette::Base, QColor(0x20, 0x20, 0x24));
        dark.setColor(QPalette::Text, QColor(0xee, 0xee, 0xee));
        dark.setColor(QPalette::Window, QColor(0x20, 0x20, 0x24));
        dark.setColor(QPalette::Highlight, QColor(0xe8, 0x89, 0xc0));
        QApplication::setPalette(dark);

        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("<html class=\"dark\">")));

        ctx->setAppearance(Theme::Appearance::Light);
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("<html class=\"light\">")));
        QVERIFY(w->currentHtml().contains(QLatin1String("--bg: #ffffff")));
        QVERIFY(w->currentHtml().contains(QLatin1String("--accent: #e889c0"))); // system accent kept
        QCOMPARE(viewer(w)->palette().color(QPalette::Base), QColor(Qt::white)); // scrollbars match
        QFile f(conf);
        QVERIFY(f.open(QIODevice::ReadOnly));
        QVERIFY(f.readAll().contains("appearance=light\n"));
        f.close();

        // Forcing the mode the system already has changes nothing.
        ctx->setAppearance(Theme::Appearance::Dark);
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("<html class=\"dark\">")));
        QVERIFY(w->currentHtml().contains(QLatin1String("--bg: #202024")));

        // Follow System: back to tracking the system palette, live.
        ctx->setAppearance(Theme::Appearance::System);
        QPalette light;
        light.setColor(QPalette::Base, Qt::white);
        light.setColor(QPalette::Text, Qt::black);
        QApplication::setPalette(light);
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("<html class=\"light\">")));
        QCOMPARE(viewer(w)->palette().color(QPalette::Base), QColor(Qt::white));

        QApplication::setPalette(original);
        delete w;
        QFile::remove(conf);
        ctx->setAppearance(Theme::Appearance::System);
        QFile::remove(conf);
    }

    // "Edit" runs the editor= command on the current file. touch and cp stand
    // in for an editor, so nothing pops up.
    static QAction *menuAction(MainWindow *w, const QString &text)
    {
        QMenu *menu = w->createContextMenu();
        menu->deleteLater();
        for (QAction *a : menu->actions())
            if (a->text().remove(QLatin1Char('&')) == text)
                return a;
        return nullptr;
    }
    static void setEditor(const QByteArray &setting)
    {
        QDir().mkpath(Theme::configDir());
        writeAtomically(Theme::configDir() + QStringLiteral("/md-whatever.conf"), "editor=" + setting + "\n");
    }

    void editOpensTheCurrentFile()
    {
        QTemporaryDir dir;
        const QString a = dir.filePath(QStringLiteral("a doc.md")), b = dir.filePath(QStringLiteral("b.md"));
        writeAtomically(a, "# A\n\n[to b](b.md)\n");
        writeAtomically(b, "# B\n");
        setEditor("touch {file}.opened");

        MainWindow *w = open(a);
        QAction *edit = menuAction(w, QStringLiteral("Edit"));
        QVERIFY(edit);
        QVERIFY(edit->isEnabled());
        QCOMPARE(edit->shortcut(), QKeySequence(Qt::Key_E));
        QTest::keyClick(w, Qt::Key_E);
        QTRY_VERIFY(QFile::exists(a + QStringLiteral(".opened"))); // a path with a space: one argument

        // After following a link, Edit opens the linked file.
        emit viewer(w)->linkClicked(QUrl(QStringLiteral("b.md")));
        QTRY_COMPARE(w->windowTitle(), QStringLiteral("b.md — md-whatever"));
        menuAction(w, QStringLiteral("Edit"))->trigger();
        QTRY_VERIFY(QFile::exists(b + QStringLiteral(".opened")));
        QVERIFY(!w->findChild<NoticeBar *>());
        delete w;
        QFile::remove(Theme::configDir() + QStringLiteral("/md-whatever.conf"));
    }

    void editCreatesAMissingFile()
    {
        // The "File not found" page can be edited: the editor creates the
        // file and the window shows it.
        QTemporaryDir dir;
        const QString src = dir.filePath(QStringLiteral("src.txt")), path = dir.filePath(QStringLiteral("new.md"));
        writeAtomically(src, "# Created by the editor\n");
        setEditor("cp " + src.toUtf8() + " {file}");
        MainWindow *w = open(path);
        QVERIFY(w->currentHtml().contains(QLatin1String("File not found")));
        QTest::keyClick(w, Qt::Key_E);
        QTRY_VERIFY(w->currentHtml().contains(QLatin1String("Created by the editor")));
        delete w;
        QFile::remove(Theme::configDir() + QStringLiteral("/md-whatever.conf"));
    }

    void editExplainsWhatWentWrong()
    {
        setEditor("/nonexistent/editor --flag");
        MainWindow *w = open(kFixtures + QStringLiteral("/kitchen-sink.md"));
        QVERIFY(!w->findChild<NoticeBar *>()); // made only when needed
        QTest::keyClick(w, Qt::Key_E);
        auto *notice = w->findChild<NoticeBar *>();
        QVERIFY(notice);
        QTRY_VERIFY(notice->isVisible());
        QVERIFY(notice->text().contains(QLatin1String("Couldn't start the editor \"/nonexistent/editor\"")));
        QVERIFY(notice->text().contains(QLatin1String("editor=")));
        QTest::keyClick(w, Qt::Key_Escape); // closes the notice first, not the window
        QVERIFY(!notice->isVisible());
        QVERIFY(w->isVisible());
        delete w;

        // stdin and folders have no file to edit
        auto *s = new MainWindow(*ctx);
        s->openStdin("# piped\n");
        s->show();
        QVERIFY(QTest::qWaitForWindowExposed(s));
        QVERIFY(!menuAction(s, QStringLiteral("Edit"))->isEnabled());
        QTest::keyClick(s, Qt::Key_E);
        QVERIFY(s->findChild<NoticeBar *>()->text().contains(QLatin1String("standard input")));
        delete s;
        MainWindow *d = open(kFixtures);
        QVERIFY(!menuAction(d, QStringLiteral("Edit"))->isEnabled());
        delete d;
        QFile::remove(Theme::configDir() + QStringLiteral("/md-whatever.conf"));
    }

    void cleanupTestCase()
    {
        delete ctx;
        QDir(QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/md-whatever")).removeRecursively();
        QDir(QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation) + QStringLiteral("/md-whatever")).removeRecursively();
    }
};

QTEST_MAIN(TestViewer)
#include "test_viewer.moc"
