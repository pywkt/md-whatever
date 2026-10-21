#include "mainwindow.h"
#include "document.h"
#include "findbar.h"
#include "timing.h"
#include "viewer.h"

#include <QActionGroup>
#include <QApplication>
#include <QClipboard>
#include <QCloseEvent>
#include <QDesktopServices>
#include <QDir>
#include <QFileInfo>
#include <QMenu>
#include <QScrollBar>
#include <QSettings>
#include <QShortcut>
#include <QStringDecoder>
#include <QTextDocument>
#include <QVBoxLayout>

#include <memory>

namespace mdread {

static const QStringList kMarkdownSuffixes = {
    QStringLiteral("md"), QStringLiteral("markdown"), QStringLiteral("mdown"),
    QStringLiteral("mkd"), QStringLiteral("mkdn"), QStringLiteral("mdwn")};

static QSettings stateSettings()
{
    return QSettings(Theme::configDir() + QStringLiteral("/state.conf"), QSettings::IniFormat);
}

// ---------------------------------------------------------------------------

AppContext::AppContext(const QString &cliTheme)
    : m_cliTheme(cliTheme)
{
    theme.load(cliTheme);
    m_debounce.setSingleShot(true);
    m_debounce.setInterval(100);
    connect(&m_debounce, &QTimer::timeout, this, &AppContext::reload);
    // Watch the files and the config dirs, since editors replace files on save
    // and a user.css may be created while the app is open.
    connect(&m_watcher, &QFileSystemWatcher::fileChanged, &m_debounce, qOverload<>(&QTimer::start));
    connect(&m_watcher, &QFileSystemWatcher::directoryChanged, &m_debounce, qOverload<>(&QTimer::start));
    QTimer::singleShot(0, this, &AppContext::rewatch); // off the startup path
}

void AppContext::reload()
{
    const QString before = theme.signature();
    theme.load(m_cliTheme);
    rewatch();
    if (theme.signature() != before) // ~/.config changes a lot; only restyle on real changes
        emit themeChanged();
}

void AppContext::setTheme(const QString &name)
{
    if (!Theme::saveSetting(QStringLiteral("theme"), name))
        qWarning("mdread: could not write %s/mdread.conf", qPrintable(Theme::configDir()));
    m_cliTheme.clear(); // the menu choice wins over --theme from now on
    m_debounce.stop();  // the conf change would trigger the same reload
    reload();
}

void AppContext::setAppearance(Theme::Appearance a)
{
    if (!Theme::saveSetting(QStringLiteral("appearance"), Theme::appearanceName(a)))
        qWarning("mdread: could not write %s/mdread.conf", qPrintable(Theme::configDir()));
    m_debounce.stop();
    reload();
}

void AppContext::rewatch()
{
    if (!m_watcher.files().isEmpty())
        m_watcher.removePaths(m_watcher.files());
    if (!m_watcher.directories().isEmpty())
        m_watcher.removePaths(m_watcher.directories());
    QStringList files;
    for (const QString &f : theme.watchedFiles())
        if (QFile::exists(f))
            files << f;
    if (!files.isEmpty())
        m_watcher.addPaths(files);
    QStringList dirs;
    // ~/.config too, so creating ~/.config/mdread while the app runs is noticed.
    for (const QString &d : {QFileInfo(Theme::configDir()).absolutePath(), Theme::configDir(),
                             Theme::configDir() + QStringLiteral("/themes")})
        if (QFileInfo(d).isDir())
            dirs << d;
    if (!dirs.isEmpty())
        m_watcher.addPaths(dirs);
}

// ---------------------------------------------------------------------------

MainWindow::MainWindow(AppContext &ctx)
    : m_ctx(ctx)
{
    setAttribute(Qt::WA_DeleteOnClose);
    auto *lay = new QVBoxLayout(this);
    lay->setContentsMargins(0, 0, 0, 0);
    lay->setSpacing(0);
    m_viewer = new Viewer(this);
    m_findBar = new FindBar(this);
    m_findBar->hide();
    lay->addWidget(m_viewer, 1);
    lay->addWidget(m_findBar);
    setFocusProxy(m_viewer);

    QSettings st = stateSettings();
    m_zoom = qBound(0.5, st.value(QStringLiteral("zoom"), 1.0).toDouble(), 3.0);
    m_viewer->setZoomFactor(m_zoom);
    resize(st.value(QStringLiteral("size"), QSize(920, 1040)).toSize());

    m_reloadTimer.setSingleShot(true);
    m_reloadTimer.setInterval(100);
    connect(&m_reloadTimer, &QTimer::timeout, this, &MainWindow::onFileChanged);
    m_rebuildTimer.setSingleShot(true);
    m_rebuildTimer.setInterval(0);
    connect(&m_rebuildTimer, &QTimer::timeout, this, [this] { rebuild(true); });

    connect(&m_watcher, &QFileSystemWatcher::fileChanged, &m_reloadTimer, qOverload<>(&QTimer::start));
    connect(&m_watcher, &QFileSystemWatcher::directoryChanged, this, [this] {
        // file re-created after an atomic save or delete+create
        if (!m_path.isEmpty() && !m_watcher.files().contains(m_path) && QFile::exists(m_path))
            m_reloadTimer.start();
    });
    connect(&ctx, &AppContext::themeChanged, &m_rebuildTimer, qOverload<>(&QTimer::start));
    connect(&MathRenderer::instance(), &MathRenderer::resultsReady, this, &MainWindow::onMathResults);
    connect(&MathRenderer::instance(), &MathRenderer::failed, this, &MainWindow::onMathResults);

    connect(m_viewer, &Viewer::linkClicked, this, &MainWindow::onLinkClicked);
    connect(m_viewer, &Viewer::contextMenuRequested, this, &MainWindow::showContextMenu);
    connect(m_viewer, &Viewer::firstPaint, this, [this] {
        timing::mark("first paint");
        if (qEnvironmentVariableIsSet("MDREAD_QUIT_AFTER_PAINT") && m_pendingMath.isEmpty())
            QTimer::singleShot(0, qApp, &QApplication::quit);
        if (m_pendingMath.isEmpty())
            maybeScreenshot();
        // Math starts only after the text is on screen.
        if (!m_pendingMath.isEmpty())
            MathRenderer::instance().request(m_pendingMath);
    });

    connect(m_findBar, &FindBar::searchChanged, this, [this] { find(false, true); });
    connect(m_findBar, &FindBar::findNext, this, [this] { find(false, false); });
    connect(m_findBar, &FindBar::findPrevious, this, [this] { find(true, false); });
    connect(m_findBar, &FindBar::closeRequested, this, [this] {
        m_findBar->hide();
        m_viewer->setFocus();
    });

    setupShortcuts();
}

void MainWindow::setupShortcuts()
{
    // Register each key once. Two QShortcuts with the same key are
    // "ambiguous" and neither fires — e.g. Ctrl+- is also the standard
    // ZoomOut key, which used to break zooming out.
    auto used = std::make_shared<QList<QKeySequence>>();
    auto add = [this, used](std::initializer_list<QKeySequence> keys, auto fn) {
        for (const QKeySequence &k : keys) {
            if (k.isEmpty() || used->contains(k))
                continue;
            used->append(k);
            auto *s = new QShortcut(k, this);
            connect(s, &QShortcut::activated, this, fn);
        }
    };
    add({QKeySequence(Qt::Key_Slash), QKeySequence::Find}, [this] { m_findBar->activate(); });
    add({QKeySequence(Qt::Key_N), QKeySequence(Qt::Key_F3)}, [this] { find(false, false); });
    add({QKeySequence(Qt::SHIFT | Qt::Key_N), QKeySequence(Qt::SHIFT | Qt::Key_F3)}, [this] { find(true, false); });
    add({QKeySequence(Qt::ALT | Qt::Key_Left), QKeySequence(Qt::Key_Back)}, [this] { goBack(); });
    add({QKeySequence(Qt::ALT | Qt::Key_Right), QKeySequence(Qt::Key_Forward)}, [this] { goForward(); });
    add({QKeySequence(Qt::Key_R), QKeySequence(Qt::Key_F5)}, [this] { onFileChanged(); });
    add({QKeySequence(Qt::CTRL | Qt::Key_Equal), QKeySequence(Qt::CTRL | Qt::Key_Plus), QKeySequence::ZoomIn},
        [this] { setZoom(m_zoom * 1.1); });
    add({QKeySequence(Qt::CTRL | Qt::Key_Minus), QKeySequence::ZoomOut}, [this] { setZoom(m_zoom / 1.1); });
    add({QKeySequence(Qt::CTRL | Qt::Key_0)}, [this] { setZoom(1.0); });
    add({QKeySequence(Qt::Key_Q), QKeySequence(Qt::CTRL | Qt::Key_W)}, [this] { close(); });
    add({QKeySequence(Qt::Key_Escape)}, [this] {
        if (m_findBar->isVisible()) {
            m_findBar->hide();
            m_viewer->setFocus();
        } else {
            close();
        }
    });
    add({QKeySequence::Copy}, [this] {
        const QString s = m_viewer->selectedText();
        if (!s.isEmpty())
            QGuiApplication::clipboard()->setText(s);
    });
}

void MainWindow::openFile(const QString &path, const QString &anchor)
{
    m_path = QFileInfo(path).absoluteFilePath();
    m_viewer->setUrl(QUrl::fromLocalFile(m_path));
    readSource();
    rebuild(false);
    if (!anchor.isEmpty())
        m_viewer->scrollToAnchor(anchor);
    watchCurrent();
    updateTitle();
}

void MainWindow::openStdin(const QByteArray &data)
{
    m_path.clear();
    m_stdin = data;
    m_viewer->setUrl(QUrl::fromLocalFile(QDir::currentPath() + QLatin1Char('/')));
    readSource();
    rebuild(false);
    updateTitle();
}

void MainWindow::readSource()
{
    m_banner.clear();
    QByteArray bytes;
    if (m_path.isEmpty()) {
        bytes = m_stdin;
    } else {
        const QFileInfo fi(m_path);
        if (!fi.exists()) {
            m_text = errorMarkdown(tr("File not found"), m_path);
            return;
        }
        if (fi.isDir()) {
            m_text = errorMarkdown(tr("This is a folder, not a file"), m_path);
            return;
        }
        QFile f(m_path);
        if (!f.open(QIODevice::ReadOnly)) {
            m_text = errorMarkdown(f.error() == QFileDevice::PermissionsError ? tr("Permission denied")
                                                                               : tr("Cannot open file"),
                                   m_path + QStringLiteral(": ") + f.errorString());
            return;
        }
        bytes = f.readAll();
    }
    if (bytes.trimmed().isEmpty()) {
        m_text = tr("*This file is empty.*");
        return;
    }
    QStringDecoder utf8(QStringDecoder::Utf8);
    QString text = utf8.decode(bytes);
    if (utf8.hasError()) {
        text = QString::fromLatin1(bytes);
        m_banner = tr("This file is not valid UTF-8. It is shown as Latin-1, so some characters may be wrong.");
    }
    m_text = text;
}

void MainWindow::rebuild(bool keepScroll)
{
    const double ratio = m_viewer->scrollRatio();
    // The window's palette follows the system; the viewer gets the forced
    // light/dark one (if any) so its scrollbars match the page.
    const QPalette pal = m_ctx.theme.effectivePalette(palette());
    const bool forced = m_ctx.theme.appearance() != Theme::Appearance::System;
    if (forced)
        m_viewer->setPalette(pal);
    else if (m_viewer->testAttribute(Qt::WA_SetPalette))
        m_viewer->setPalette(QPalette()); // back to inheriting the system palette
    const bool dark = Theme::isDark(pal);
    m_ctx.highlighter.setTheme(m_ctx.theme.codeTheme(), dark);
    m_viewer->setMathColor(m_ctx.theme.textColor(pal, dark));

    BuildInput in;
    in.markdown = m_text;
    in.css = m_ctx.theme.css(pal, dark);
    in.dark = dark;
    in.banner = m_banner;
    if (!m_ctx.theme.warning().isEmpty())
        in.banner = in.banner.isEmpty() ? m_ctx.theme.warning() : in.banner + QLatin1Char(' ') + m_ctx.theme.warning();
    in.mathScale = m_zoom * devicePixelRatioF();
    timing::mark("build start");
    BuiltDocument doc = buildDocument(in, m_ctx.highlighter);
    timing::mark("markdown + highlight done");
    m_html = doc.html;
    m_pendingMath = doc.pendingMath;
    if (!isVisible() && layout())
        layout()->activate(); // give the viewer its real size first: layout happens once, at the right width
    m_viewer->setHtml(m_html);
    timing::mark("layout done");
    if (keepScroll)
        m_viewer->setScrollRatio(ratio);
    if (m_pendingMath.isEmpty()) {
        emit mathSettled();
        if (keepScroll && isVisible())
            QTimer::singleShot(50, this, &MainWindow::maybeScreenshot);
    }
    else if (isVisible() && keepScroll)
        MathRenderer::instance().request(m_pendingMath); // reload: already painted once
}

void MainWindow::onMathResults()
{
    if (m_pendingMath.isEmpty())
        return;
    MathRenderer &m = MathRenderer::instance();
    if (m.available()) {
        for (const MathRequest &r : std::as_const(m_pendingMath))
            if (!m.lookup(r.key))
                return; // still waiting for some of ours
    }
    rebuild(true); // shows images, or TeX source if math is unavailable
}

QString MainWindow::currentHtml() const { return m_html; }

// Developer aid: MDREAD_SCREENSHOT=out.png saves the window once text and
// math are rendered, then quits. MDREAD_SCREENSHOT_SCROLL=0..1 scrolls first.
void MainWindow::maybeScreenshot()
{
    const QString out = qEnvironmentVariable("MDREAD_SCREENSHOT");
    if (out.isEmpty() || !m_pendingMath.isEmpty())
        return;
    if (qEnvironmentVariableIsSet("MDREAD_SCREENSHOT_SCROLL"))
        m_viewer->setScrollRatio(qEnvironmentVariable("MDREAD_SCREENSHOT_SCROLL").toDouble());
    QTimer::singleShot(30, this, [this, out] {
        grab().save(out);
        qApp->quit();
    });
}

void MainWindow::watchCurrent()
{
    if (!m_watcher.files().isEmpty())
        m_watcher.removePaths(m_watcher.files());
    if (!m_watcher.directories().isEmpty())
        m_watcher.removePaths(m_watcher.directories());
    if (m_path.isEmpty())
        return;
    if (QFile::exists(m_path))
        m_watcher.addPath(m_path);
    const QString dir = QFileInfo(m_path).absolutePath();
    if (QFileInfo(dir).isDir())
        m_watcher.addPath(dir);
}

void MainWindow::onFileChanged()
{
    if (m_path.isEmpty())
        return;
    readSource();
    rebuild(true);
    // Editors save by replacing the file, which drops the watch: re-add it.
    if (QFile::exists(m_path) && !m_watcher.files().contains(m_path))
        m_watcher.addPath(m_path);
}

void MainWindow::updateTitle()
{
    const QString name = m_path.isEmpty() ? tr("(stdin)") : QFileInfo(m_path).fileName();
    setWindowTitle(name + QStringLiteral(" — mdread"));
}

void MainWindow::onLinkClicked(const QUrl &raw)
{
    const QUrl base = m_viewer->url();
    const QUrl url = raw.isRelative() ? base.resolved(raw) : raw;
    const QString scheme = url.scheme();
    if (scheme == QLatin1String("http") || scheme == QLatin1String("https") || scheme == QLatin1String("mailto")) {
        QDesktopServices::openUrl(url);
        return;
    }
    if (!url.isLocalFile())
        return; // unknown scheme: ignore
    const QString fragment = url.fragment(QUrl::FullyDecoded);
    if (url.adjusted(QUrl::RemoveFragment) == base.adjusted(QUrl::RemoveFragment)) {
        if (!fragment.isEmpty()) { // in-document anchor
            m_back.append({m_path, m_viewer->scrollY()});
            m_forward.clear();
            m_viewer->scrollToAnchor(fragment);
        }
        return;
    }
    const QString path = url.toLocalFile();
    if (kMarkdownSuffixes.contains(QFileInfo(path).suffix().toLower()))
        navigate(path, fragment);
    else
        QDesktopServices::openUrl(url.adjusted(QUrl::RemoveFragment)); // images, PDFs, ... in their apps
}

void MainWindow::navigate(const QString &path, const QString &anchor)
{
    m_back.append({m_path, m_viewer->scrollY()});
    m_forward.clear();
    openFile(path, anchor);
}

void MainWindow::goBack()
{
    if (m_back.isEmpty())
        return;
    m_forward.append({m_path, m_viewer->scrollY()});
    const HistoryEntry e = m_back.takeLast();
    if (e.path != m_path && !e.path.isEmpty())
        openFile(e.path);
    m_viewer->setScrollY(e.scrollY);
}

void MainWindow::goForward()
{
    if (m_forward.isEmpty())
        return;
    m_back.append({m_path, m_viewer->scrollY()});
    const HistoryEntry e = m_forward.takeLast();
    if (e.path != m_path && !e.path.isEmpty())
        openFile(e.path);
    m_viewer->setScrollY(e.scrollY);
}

void MainWindow::setZoom(double z)
{
    z = qBound(0.5, z, 3.0);
    if (qAbs(z - 1.0) < 0.02)
        z = 1.0;
    m_zoom = z;
    m_viewer->setZoomFactor(z);
    rebuild(true); // re-rasterize math at the new size
    stateSettings().setValue(QStringLiteral("zoom"), z);
}

void MainWindow::find(bool backward, bool incremental)
{
    const QString text = m_findBar->text();
    if (text.isEmpty()) {
        if (!incremental)
            m_findBar->activate();
        m_findBar->setStatus(QString(), false);
        return;
    }
    bool wrapped = false;
    QTextDocument::FindFlags flags;
    if (backward)
        flags |= QTextDocument::FindBackward;
    const bool found = m_viewer->findText(text, flags, incremental, &wrapped);
    m_findBar->setStatus(found ? (wrapped ? tr("Wrapped around") : QString()) : tr("Not found"), !found);
}

QMenu *MainWindow::createContextMenu()
{
    auto *menu = new QMenu(this);
    menu->addAction(QIcon::fromTheme(QStringLiteral("view-refresh")), tr("Reload"), QKeySequence(Qt::Key_F5),
                    this, &MainWindow::onFileChanged)->setEnabled(!m_path.isEmpty());
    QAction *copy = menu->addAction(QIcon::fromTheme(QStringLiteral("edit-copy")), tr("Copy"), QKeySequence::Copy, this, [this] {
        QGuiApplication::clipboard()->setText(m_viewer->selectedText());
    });
    copy->setEnabled(!m_viewer->selectedText().isEmpty());
    menu->addAction(QIcon::fromTheme(QStringLiteral("edit-find")), tr("Find…"), QKeySequence::Find, this,
                    [this] { m_findBar->activate(); });
    menu->addSeparator();

    // Theme submenu: built-ins, then ~/.config/mdread/themes/*.css.
    QMenu *themes = menu->addMenu(QIcon::fromTheme(QStringLiteral("preferences-desktop-theme")), tr("Theme"));
    auto *group = new QActionGroup(themes);
    for (const QString &name : Theme::available()) {
        QAction *a = themes->addAction(name);
        a->setCheckable(true);
        a->setChecked(name == m_ctx.theme.name());
        a->setActionGroup(group);
        // Queued: the menu (and this action) may be gone by the time windows restyle.
        connect(a, &QAction::triggered, &m_ctx, [ctx = &m_ctx, name] {
            QTimer::singleShot(0, ctx, [ctx, name] { ctx->setTheme(name); });
        });
    }
    themes->addSeparator();
    auto *modes = new QActionGroup(themes);
    const std::pair<Theme::Appearance, QString> appearances[] = {
        {Theme::Appearance::System, tr("Follow System")},
        {Theme::Appearance::Light, tr("Light")},
        {Theme::Appearance::Dark, tr("Dark")},
    };
    for (const auto &[mode, label] : appearances) {
        QAction *a = themes->addAction(label);
        a->setCheckable(true);
        a->setChecked(mode == m_ctx.theme.appearance());
        a->setActionGroup(modes);
        connect(a, &QAction::triggered, &m_ctx, [ctx = &m_ctx, mode] {
            QTimer::singleShot(0, ctx, [ctx, mode] { ctx->setAppearance(mode); });
        });
    }
    themes->addSeparator();
    themes->addAction(QIcon::fromTheme(QStringLiteral("document-open-folder")), tr("Open Themes Folder"), this, [] {
        const QString dir = Theme::configDir() + QStringLiteral("/themes");
        QDir().mkpath(dir);
        QDesktopServices::openUrl(QUrl::fromLocalFile(dir));
    });

    menu->addSeparator();
    menu->addAction(QIcon::fromTheme(QStringLiteral("document-open-folder")), tr("Open Containing Folder"), this, [this] {
        QDesktopServices::openUrl(QUrl::fromLocalFile(QFileInfo(m_path).absolutePath()));
    })->setEnabled(!m_path.isEmpty());
    return menu;
}

void MainWindow::showContextMenu(const QPoint &pos, const QUrl &url)
{
    Q_UNUSED(url);
    QMenu *menu = createContextMenu();
    menu->exec(m_viewer->viewport()->mapToGlobal(pos));
    menu->deleteLater();
}

void MainWindow::changeEvent(QEvent *e)
{
    // Plasma light/dark switch arrives as a palette change: restyle live.
    if (e->type() == QEvent::ApplicationPaletteChange || e->type() == QEvent::PaletteChange)
        m_rebuildTimer.start();
    QWidget::changeEvent(e);
}

void MainWindow::closeEvent(QCloseEvent *e)
{
    stateSettings().setValue(QStringLiteral("size"), size());
    QWidget::closeEvent(e);
}

} // namespace mdread
