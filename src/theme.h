// Theme loading: built-in or user CSS themes plus user.css, with system
// palette and font values exposed to CSS as var(--name).
#pragma once

#include <QColor>
#include <QFont>
#include <QPalette>
#include <QString>
#include <QStringList>

namespace mdread {

class Theme
{
public:
    // Light/dark: follow the system palette, or force one.
    enum class Appearance { System, Light, Dark };

    // ~/.config/mdread
    static QString configDir();
    static bool isDark(const QPalette &palette);
    // Names of built-in and user themes.
    static QStringList available();

    // Reads mdread.conf, the theme file and user.css. cliTheme overrides the config.
    void load(const QString &cliTheme = QString());

    // Sets KEY=VALUE in mdread.conf, keeping the rest of the file as it is.
    static bool saveSetting(const QString &key, const QString &value);

    Appearance appearance() const { return m_appearance; }
    static QString appearanceName(Appearance a);
    // The palette documents are styled from: the system one, or a Breeze
    // light/dark palette (keeping the system accent) when the forced
    // appearance differs from the system's.
    QPalette effectivePalette(const QPalette &system) const;

    QString name() const { return m_name; }
    QString codeTheme() const { return m_codeTheme; }
    QString warning() const { return m_warning; } // e.g. unknown theme name
    // Changes whenever anything that affects styling changes.
    QString signature() const
    {
        return m_name + QLatin1Char('|') + m_codeTheme + QLatin1Char('|') + appearanceName(m_appearance)
               + QLatin1Char('|') + m_themeCss + m_userCss;
    }

    // Full stylesheet: variables, then theme, then user.css.
    QString css(const QPalette &palette, bool dark) const;

    // Base text size in CSS px before zoom (also used to size math images).
    static double basePx();
    // Effective text color after theme/user overrides of --text (for math).
    QColor textColor(const QPalette &palette, bool dark) const;

    // Files to watch for live restyling (theme file, user.css, mdread.conf).
    QStringList watchedFiles() const;

private:
    QString m_name = QStringLiteral("default");
    QString m_codeTheme;
    Appearance m_appearance = Appearance::System;
    QString m_themeCss;
    QString m_userCss;
    QString m_themePath; // empty for built-in
    QString m_warning;
};

} // namespace mdread
