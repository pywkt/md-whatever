// One window per document: loading, live reload, history, links, find,
// zoom, context menu, palette following.
#pragma once

#include "highlight.h"
#include "math.h"
#include "theme.h"

#include <QFileSystemWatcher>
#include <QList>
#include <QTimer>
#include <QWidget>

class QMenu;

namespace mdread {

class Viewer;
class FindBar;

// State shared by all windows: theme, highlighter, theme-file watching.
class AppContext : public QObject
{
    Q_OBJECT
public:
    explicit AppContext(const QString &cliTheme);
    Theme theme;
    Highlighter highlighter;

    // Switch every window to a theme and remember it in mdread.conf
    // (this also drops a --theme given on the command line).
    void setTheme(const QString &name);
    // Light / dark / follow the system, for every window; saved in mdread.conf.
    void setAppearance(Theme::Appearance a);

signals:
    void themeChanged();

private:
    void reload();
    void rewatch();
    QString m_cliTheme;
    QFileSystemWatcher m_watcher;
    QTimer m_debounce;
};

class MainWindow : public QWidget
{
    Q_OBJECT
public:
    explicit MainWindow(AppContext &ctx);

    void openFile(const QString &path, const QString &anchor = QString());
    void openStdin(const QByteArray &data);

    // For --dump-html: the current page, after math (if any) has finished.
    QString currentHtml() const;
    bool mathPending() const { return !m_pendingMath.isEmpty(); }
    void requestPendingMath() { MathRenderer::instance().request(m_pendingMath); }

    // The right-click menu (separate from showing it, for tests).
    QMenu *createContextMenu();

signals:
    void mathSettled(); // pending math rendered or given up

protected:
    void changeEvent(QEvent *e) override;
    void closeEvent(QCloseEvent *e) override;

private:
    struct HistoryEntry {
        QString path;
        int scrollY = 0;
    };

    void readSource();
    void rebuild(bool keepScroll);
    void watchCurrent();
    void onFileChanged();
    void onLinkClicked(const QUrl &url);
    void navigate(const QString &path, const QString &anchor);
    void goBack();
    void goForward();
    void setZoom(double z);
    void find(bool backward, bool incremental);
    void showContextMenu(const QPoint &pos, const QUrl &url);
    void onMathResults();
    void updateTitle();
    void setupShortcuts();
    void maybeScreenshot();

    AppContext &m_ctx;
    Viewer *m_viewer;
    FindBar *m_findBar;

    QString m_path;        // empty when reading stdin
    QByteArray m_stdin;
    QString m_text;        // decoded Markdown source
    QString m_banner;
    QString m_html;
    QList<MathRequest> m_pendingMath;
    double m_zoom = 1.0;

    QList<HistoryEntry> m_back, m_forward;
    QFileSystemWatcher m_watcher;
    QTimer m_reloadTimer, m_rebuildTimer;
};

} // namespace mdread
