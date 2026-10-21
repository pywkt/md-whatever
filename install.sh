#!/usr/bin/env bash
# md-whatever installer: installs what's needed to build, builds, installs into
# your home folder (no root needed for that part), and offers to make
# md-whatever the default app for Markdown files.
#
#   ./install.sh               install or update
#   ./install.sh --uninstall   remove it again (your settings are kept)
#   ./install.sh --prefix DIR  install somewhere other than ~/.local
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

PREFIX="$HOME/.local"
ACTION=install
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) ACTION=uninstall ;;
    --prefix) PREFIX="$(readlink -m "${2:?--prefix needs a folder}")"; shift ;;
    -h|--help) sed -n '2,8s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

BUILD_DIR=build
DATA_DIR="$PREFIX/share/md-whatever"
DESKTOP_FILE="$PREFIX/share/applications/md-whatever.desktop"
PREVIOUS_DEFAULT_FILE="$DATA_DIR/previous-default"
MIME_TYPES=(text/markdown text/x-markdown)

# Packages (Arch names). The last two are only for math.
BUILD_PKGS=(base-devel cmake ninja qt6-base qt6-svg litehtml md4c syntax-highlighting)
MATH_PKGS=(nodejs mathjax)

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ask "Question?" y|n  -> returns 0 for yes. Enter (or no input at all)
# takes the default.
ask() {
  local prompt="$1" default="$2" hint answer=""
  [ "$default" = y ] && hint="[Y/n]" || hint="[y/N]"
  printf '  %s %s ' "$prompt" "$hint"
  read -r answer || true
  [ -t 0 ] || echo "${answer:-}" # piped answers: finish the line
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

current_default() { xdg-mime query default text/markdown 2>/dev/null || true; }

refresh_desktop_caches() {
  command -v update-desktop-database >/dev/null && update-desktop-database -q "$PREFIX/share/applications" 2>/dev/null || true
  command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true # KDE's app list
}

# --------------------------------------------------------------------------
uninstall() {
  bold "Removing md-whatever from $PREFIX"
  if [ "$(current_default)" = md-whatever.desktop ]; then
    local previous=""
    [ -f "$PREVIOUS_DEFAULT_FILE" ] && previous="$(cat "$PREVIOUS_DEFAULT_FILE")"
    if [ -n "$previous" ] && [ "$previous" != md-whatever.desktop ]; then
      for t in "${MIME_TYPES[@]}"; do xdg-mime default "$previous" "$t"; done
      info "Markdown files open with $previous again."
    else
      info "md-whatever was your default for Markdown files; your system will pick another app."
    fi
  fi
  rm -f "$PREFIX/bin/md-whatever" "$DESKTOP_FILE"
  rm -rf "$DATA_DIR"
  refresh_desktop_caches
  info "Done. Your settings (~/.config/md-whatever) and math cache (~/.cache/md-whatever) were kept;"
  info "delete those folders too if you want everything gone."
}

# --------------------------------------------------------------------------
install_packages() {
  bold "1/4  Checking what's needed to build md-whatever"
  if command -v pacman >/dev/null; then
    local missing=() math_missing=()
    # pacman -T prints the packages that aren't installed (base-devel is a group-like meta package)
    mapfile -t missing < <(pacman -T "${BUILD_PKGS[@]}" || true)
    mapfile -t math_missing < <(pacman -T "${MATH_PKGS[@]}" || true)
    if [ ${#math_missing[@]} -gt 0 ]; then
      info "For math equations md-whatever also uses: ${math_missing[*]}"
      if ask "Install those too?" y; then missing+=("${math_missing[@]}"); else
        info "OK — equations will be shown as TeX source. You can install them later."
      fi
    fi
    if [ ${#missing[@]} -gt 0 ]; then
      info "Needed packages: ${missing[*]}"
      ask "Install them now with 'sudo pacman -S --needed'? (asks for your password)" y \
        || die "Can't build without them. Install them and run this script again."
      sudo pacman -S --needed "${missing[@]}"
    else
      info "Everything is already installed."
    fi
  else
    info "This script installs packages automatically only on Arch Linux."
    info "On other systems, install the equivalents of these Arch packages first:"
    info "  ${BUILD_PKGS[*]}  (and ${MATH_PKGS[*]} for math)"
    info "md-whatever needs Qt 6.5 or newer, litehtml 0.10 and KDE Frameworks 6."
    ask "Are they installed? Continue?" n || exit 1
  fi
}

build_and_install() {
  bold "2/4  Building (this takes a minute or two the first time)"
  local generator=()
  command -v ninja >/dev/null && generator=(-G Ninja)
  if [ -f "$BUILD_DIR/CMakeCache.txt" ]; then generator=(); fi # keep whatever the build folder already uses
  cmake -S . -B "$BUILD_DIR" "${generator[@]}" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" >/dev/null \
    || die "Setting up the build failed (see the messages above). Usually a missing package."
  cmake --build "$BUILD_DIR" --target md-whatever || die "Building failed (see the messages above)."

  bold "3/4  Installing into $PREFIX"
  cmake --install "$BUILD_DIR" >/dev/null || die "Installing failed (see the messages above)."
  refresh_desktop_caches
  info "Installed $PREFIX/bin/md-whatever"
  case ":$PATH:" in
    *":$PREFIX/bin:"*) ;;
    *) info "Note: $PREFIX/bin isn't on your PATH, so typing 'md-whatever' in a terminal won't"
       info "work yet (opening files from your file manager will). To fix that, add this"
       info "line to ~/.bashrc (or your shell's startup file) and open a new terminal:"
       info "  export PATH=\"$PREFIX/bin:\$PATH\"" ;;
  esac
}

offer_default() {
  bold "4/4  Default app for Markdown files"
  command -v xdg-mime >/dev/null || { info "xdg-mime not found; skipping."; return; }
  # The desktop only finds apps in its data folders; a custom --prefix may not be one.
  case ":${XDG_DATA_HOME:-$HOME/.local/share}:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}:" in
    *":$PREFIX/share:"*|*":$PREFIX/share/:"*) ;;
    *) info "$PREFIX/share isn't one of the folders your desktop looks in for apps,"
       info "so md-whatever won't appear in menus or as a default app. Skipping this step."
       return ;;
  esac
  local current
  current="$(current_default)"
  if [ "$current" = md-whatever.desktop ]; then
    info "md-whatever already opens .md files."
    return
  fi
  info "Right now .md files open with: ${current:-nothing set}"
  if ask "Open .md files with md-whatever from now on?" y; then
    [ -n "$current" ] && printf '%s\n' "$current" > "$PREVIOUS_DEFAULT_FILE"
    for t in "${MIME_TYPES[@]}"; do xdg-mime default md-whatever.desktop "$t"; done
    refresh_desktop_caches
    info "Done. './install.sh --uninstall' puts ${current:-the old setting} back."
  else
    info "Left as it is. You can still right-click a file → Open With → md-whatever."
  fi
}

# --------------------------------------------------------------------------
if [ "$ACTION" = uninstall ]; then
  uninstall
  exit 0
fi

[ "$(id -u)" -ne 0 ] || die "Run this as your normal user, not with sudo (it asks for sudo itself if needed)."
install_packages
build_and_install
offer_default
bold "All set."
info "Open a Markdown file from your file manager, or run: md-whatever FILE.md"
info "Right-click a document for themes and light/dark. Update later by running this script again."
