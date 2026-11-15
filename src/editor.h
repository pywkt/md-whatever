// "Edit": which program opens the current file in the user's text editor.
// md-whatever itself never edits; it starts the editor and live reload does
// the rest.
#pragma once

#include <QString>
#include <QStringList>

namespace mdw {

struct EditorCommand {
    QString program;
    QStringList args;
    QString error; // non-empty: no command; a sentence for the window's notice
};

// The editor= line from md-whatever.conf's text, as written (QSettings would
// strip quotes and split at commas). Top level or [General], like
// Theme::saveSetting. Empty when there's none.
QString editorSetting(const QString &confText);

// From an editor= setting: split like a shell (QProcess::splitCommand), then
// put the path in place of {file} in every argument, also inside a longer one
// ("{file}:1"). Without {file}, the path is the last argument. Splitting comes
// first, so a path with spaces or quotes stays one argument.
EditorCommand commandFromSetting(const QString &setting, const QString &path);

// From a .desktop file's text: Exec= of [Desktop Entry], split by the
// desktop entry spec's quoting rules, %f %F as the path, %u %U as a file://
// URL, other field codes dropped, %% as %. Terminal=true is an error (there's
// no terminal to run it in).
EditorCommand commandFromDesktopEntry(const QString &desktopText, const QString &path);

// "Set editor= in ~/.config/md-whatever/md-whatever.conf (for example editor=kate)."
QString editorSettingHint();

// The whole chain: editor= in md-whatever.conf, else the desktop's default
// app for text/plain (xdg-mime), else an error. Run only when asked to edit.
EditorCommand resolveEditor(const QString &path);

} // namespace mdw
