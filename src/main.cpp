// md-whatever: a fast, read-only Markdown viewer.
#include "mainwindow.h"
#include "timing.h"

#include <QApplication>
#include <QCommandLineParser>
#include <QFile>
#include <QTimer>
#include <QUrl>

#include <cstdio>

using namespace mdw;

int main(int argc, char **argv)
{
    timing::start();
    // --time must be known before QApplication exists to time its startup.
    for (int i = 1; i < argc; ++i)
        if (qstrcmp(argv[i], "--time") == 0)
            timing::setEnabled(true);

    QApplication app(argc, argv);
    Q_INIT_RESOURCE(resources); // built-in themes live in a static library
    timing::mark("QApplication ready");
    QApplication::setApplicationName(QStringLiteral("md-whatever"));
    QApplication::setApplicationVersion(QStringLiteral(MDW_VERSION));
    QApplication::setDesktopFileName(QStringLiteral("md-whatever"));
    QApplication::setWindowIcon(QIcon::fromTheme(QStringLiteral("text-markdown")));

    QCommandLineParser cli;
    cli.setApplicationDescription(QStringLiteral("Read Markdown files."));
    cli.addHelpOption();
    cli.addVersionOption();
    const QCommandLineOption themeOpt(QStringLiteral("theme"), QStringLiteral("Use theme <name> for this run."),
                                      QStringLiteral("name"));
    const QCommandLineOption dumpOpt(QStringLiteral("dump-html"), QStringLiteral("Print the rendered HTML and exit."));
    const QCommandLineOption timeOpt(QStringLiteral("time"), QStringLiteral("Log startup timings to stderr."));
    cli.addOptions({themeOpt, dumpOpt, timeOpt});
    cli.addPositionalArgument(QStringLiteral("files"), QStringLiteral("Markdown files to open, or - for stdin."),
                              QStringLiteral("FILE..."));
    cli.process(app);

    QStringList files = cli.positionalArguments();
    if (files.isEmpty()) {
        std::fputs("md-whatever: no file given. Usage: md-whatever FILE [FILE...]  (or - for stdin)\n", stderr);
        return 2;
    }

    AppContext ctx(cli.value(themeOpt));
    timing::mark("theme loaded");

    QByteArray stdinData;
    if (files.contains(QStringLiteral("-"))) {
        QFile in;
        if (in.open(stdin, QIODevice::ReadOnly))
            stdinData = in.readAll();
    }

    auto open = [&](MainWindow *w, const QString &arg) {
        if (arg == QLatin1String("-")) {
            w->openStdin(stdinData);
            return;
        }
        // Accept file:// URLs as well as paths (some launchers pass URLs).
        const QUrl url(arg);
        if (url.isLocalFile())
            w->openFile(url.toLocalFile(), url.fragment(QUrl::FullyDecoded));
        else
            w->openFile(arg);
    };

    if (cli.isSet(dumpOpt)) {
        int pending = 0;
        QList<MainWindow *> windows;
        for (const QString &f : std::as_const(files)) {
            auto *w = new MainWindow(ctx);
            open(w, f);
            windows << w;
            if (w->mathPending()) { // dump waits for math so the output is complete
                ++pending;
                QObject::connect(w, &MainWindow::mathSettled, &app, [&] {
                    if (--pending == 0)
                        app.quit();
                });
                w->requestPendingMath();
            }
        }
        if (pending) {
            QTimer::singleShot(30000, &app, &QApplication::quit); // never hang
            app.exec();
        }
        for (MainWindow *w : std::as_const(windows)) {
            std::fputs(w->currentHtml().toUtf8().constData(), stdout);
            delete w;
        }
        return 0;
    }

    for (const QString &f : std::as_const(files)) {
        auto *w = new MainWindow(ctx);
        open(w, f);
        w->show();
    }
    timing::mark("windows shown");
    return app.exec();
}
