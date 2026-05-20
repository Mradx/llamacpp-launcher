#!/usr/bin/env bash
#
# llamacpp-launcher.command — macOS bootstrapper / installer.
#
# Double-clickable in Finder (opens Terminal) and runnable as ./llamacpp-launcher.command.
# It locates or installs a supported Node.js runtime and Git, installs (or updates) the
# packaged app from a llamacpp-launcher-<version>.tgz placed next to this script, and
# launches the interactive TUI. The Windows equivalent is llamacpp-launcher.bat.

set -u
set -o pipefail

APP_NAME='llamacpp-launcher'
NODE_REQUIREMENT='20.19+, 22.13+, or 24+'

SCRIPT_PATH=''
SCRIPT_DIR=''
INSTALL_ROOT=''
NPM_PREFIX=''
NPM_CACHE=''
NODE_HOME=''
APP_DIR=''
APP_ENTRY=''
APP_PKG=''
VERSION_MARKER=''
LOG=''
NODE=''
NPM=''
NODE_VERSION=''
GIT=''
APP_EXIT=0

SELF_TEST=0
if [ "${1:-}" = '--self-test' ]; then
  SELF_TEST=1
fi

# ── UI ──

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_CYAN=$'\033[36m'; C_WHITE=$'\033[97m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_GRAY=$'\033[90m'
else
  C_RESET=''; C_CYAN=''; C_WHITE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_GRAY=''
fi

ts() { date '+%Y-%m-%d %H:%M:%S'; }

log() {
  [ -n "$LOG" ] || return 0
  printf '[%s] %s\n' "$(ts)" "$*" >>"$LOG" 2>/dev/null || true
}

section() {
  printf '\n%s-- %s%s\n' "$C_CYAN" "$1" "$C_RESET"
}

kv() {
  local v="$2"
  [ -n "$v" ] || v='n/a'
  printf '  %s%-12s%s %s\n' "$C_GRAY" "$1" "$C_RESET" "$v"
}

status() {
  local label="$1" color="$2" msg="$3" detail="${4:-}"
  printf '  %s%-7s%s %s\n' "$color" "$label" "$C_RESET" "$msg"
  [ -n "$detail" ] && printf '          %s%s%s\n' "$C_GRAY" "$detail" "$C_RESET"
  return 0
}

ok()   { status '[OK]'   "$C_GREEN"  "$1" "${2:-}"; }
warn() { status '[WARN]' "$C_YELLOW" "$1" "${2:-}"; }
err()  { status '[ERROR]' "$C_RED"   "$1" "${2:-}"; }
info() { status '[INFO]' "$C_GRAY"   "$1" "${2:-}"; }
step() { status '[RUN]'  "$C_CYAN"   "$1" "${2:-}"; }

header() {
  [ "$SELF_TEST" = '1' ] || { [ -t 1 ] && clear 2>/dev/null || true; }
  printf '\n%s============================================================%s\n' "$C_CYAN" "$C_RESET"
  printf ' %sLLAMACPP-LAUNCHER%s\n' "$C_WHITE" "$C_RESET"
  printf '%s============================================================%s\n' "$C_CYAN" "$C_RESET"
  kv 'Script' "$SCRIPT_PATH"
  kv 'Install root' "$INSTALL_ROOT"
  kv 'Log file' "$LOG"
}

die() {
  section 'Failure'
  err 'Launcher failed.' "$*"
  kv 'Log file' "$LOG"
  log "FAILED: $*"
  exit 1
}

run_logged() {
  log "Running: $*"
  "$@" >>"$LOG" 2>&1
}

run_tee() {
  log "Running: $*"
  "$@" 2>&1 | tee -a "$LOG"
  return "${PIPESTATUS[0]}"
}

# ── Paths ──

resolve_script_path() {
  local source="${BASH_SOURCE[0]}" dir
  while [ -L "$source" ]; do
    dir="$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)"
    source="$(readlink "$source")"
    case "$source" in
      /*) ;;
      *) source="$dir/$source" ;;
    esac
  done
  SCRIPT_DIR="$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)"
  SCRIPT_PATH="$SCRIPT_DIR/$(basename "$source")"
}

init_paths() {
  resolve_script_path

  local root="${LLAMACPP_LAUNCHER_HOME:-}"
  [ -n "$root" ] || root="$HOME/.llamacpp-launcher"
  mkdir -p "$root" 2>/dev/null || true
  INSTALL_ROOT="$root"

  NPM_PREFIX="$INSTALL_ROOT/npm-prefix"
  NPM_CACHE="$INSTALL_ROOT/npm-cache"
  NODE_HOME="$INSTALL_ROOT/node"
  # Unix `npm -g --prefix` installs under <prefix>/lib/node_modules (Windows omits lib/).
  APP_DIR="$NPM_PREFIX/lib/node_modules/$APP_NAME"
  APP_ENTRY="$APP_DIR/dist/index.js"
  APP_PKG="$APP_DIR/package.json"
  VERSION_MARKER="$INSTALL_ROOT/installed-version.txt"
  export LLAMACPP_LAUNCHER_HOME="$INSTALL_ROOT"
}

start_log() {
  LOG="$SCRIPT_DIR/$APP_NAME.log"
  if ! printf '[%s] %s started\n' "$(ts)" "$APP_NAME" >"$LOG" 2>/dev/null; then
    LOG="${TMPDIR:-/tmp}/$APP_NAME.log"
    printf '[%s] %s started\n' "$(ts)" "$APP_NAME" >"$LOG" 2>/dev/null || true
  fi
  log "Script path: $SCRIPT_PATH"
  log "Install root: $INSTALL_ROOT"
}

# ── Version helpers (pure shell, no Node dependency) ──

node_supported() {
  local v="${1#v}" major minor rest
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) minor=0 ;; esac
  if [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; then return 0; fi
  if [ "$major" -ge 24 ]; then return 0; fi
  return 1
}

ver_field() {
  local f
  f="$(printf '%s' "$1" | cut -d. -f"$2")"
  case "$f" in ''|*[!0-9]*) f=0 ;; esac
  printf '%s' "$f"
}

# True (0) if $1 > $2 by major.minor.patch (prerelease/build suffix ignored).
version_gt() {
  local a="${1%%[-+]*}" b="${2%%[-+]*}" i av bv
  for i in 1 2 3; do
    av="$(ver_field "$a" "$i")"
    bv="$(ver_field "$b" "$i")"
    if [ "$av" -gt "$bv" ]; then return 0; fi
    if [ "$av" -lt "$bv" ]; then return 1; fi
  done
  return 1
}

# ── Homebrew ──

brew_bin() {
  local b
  b="$(command -v brew 2>/dev/null)" && { printf '%s' "$b"; return 0; }
  [ -x /opt/homebrew/bin/brew ] && { printf '%s' /opt/homebrew/bin/brew; return 0; }
  [ -x /usr/local/bin/brew ] && { printf '%s' /usr/local/bin/brew; return 0; }
  return 1
}

have_brew() { brew_bin >/dev/null 2>&1; }

# ── PATH ──

prepend_path() {
  local dir="$1"
  [ -n "$dir" ] || return 0
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) PATH="$dir:$PATH"; export PATH ;;
  esac
}

# ── Node ──

node_candidates() {
  command -v node 2>/dev/null || true
  printf '%s\n' \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$NODE_HOME/bin/node" \
    "$HOME/.volta/bin/node" \
    /opt/local/bin/node
  if [ -d "$HOME/.nvm/versions/node" ]; then
    local d
    for d in $(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -rV); do
      printf '%s\n' "$HOME/.nvm/versions/node/$d/bin/node"
    done
  fi
}

try_node_candidate() {
  local cand="$1" ver bindir
  [ -n "$cand" ] || return 1
  [ -x "$cand" ] || return 1
  ver="$("$cand" --version 2>/dev/null)" || return 1
  [ -n "$ver" ] || return 1
  node_supported "$ver" || return 1
  NODE="$cand"
  NODE_VERSION="$ver"
  bindir="$(dirname "$cand")"
  if [ -x "$bindir/npm" ]; then NPM="$bindir/npm"; else NPM='npm'; fi
  return 0
}

scan_node() {
  local cand
  while IFS= read -r cand; do
    if try_node_candidate "$cand"; then
      prepend_path "$(dirname "$NODE")"
      return 0
    fi
  done <<EOF
$(node_candidates)
EOF
  return 1
}

install_node_direct() {
  local arch tarch file url tmp
  arch="$(uname -m)"
  case "$arch" in
    arm64) tarch='arm64' ;;
    x86_64) tarch='x64' ;;
    *) die "Unsupported CPU architecture for Node.js download: $arch" ;;
  esac

  step "Downloading the official Node.js LTS for darwin-$tarch." 'from nodejs.org'
  log "Resolving Node.js LTS for darwin-$tarch"
  file="$(curl -fsSL 'https://nodejs.org/dist/latest-lts/' 2>>"$LOG" \
    | grep -oE "node-v[0-9]+\.[0-9]+\.[0-9]+-darwin-$tarch\.tar\.gz" \
    | head -n1 || true)"
  [ -n "$file" ] || die 'Could not determine the latest Node.js LTS filename from nodejs.org.'

  url="https://nodejs.org/dist/latest-lts/$file"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/llamacpp-node.XXXXXX")"
  log "Downloading $url"
  if ! curl -fSL --retry 2 -o "$tmp/$file" "$url" 2>>"$LOG"; then
    rm -rf "$tmp"
    die "Failed to download Node.js from $url"
  fi

  rm -rf "$NODE_HOME"
  mkdir -p "$NODE_HOME"
  if ! tar -xzf "$tmp/$file" -C "$NODE_HOME" --strip-components=1 2>>"$LOG"; then
    rm -rf "$tmp"
    die 'Failed to extract the Node.js archive.'
  fi
  rm -rf "$tmp"
  ok 'Node.js installed into the launcher data directory.' "$NODE_HOME"
}

ensure_node() {
  section 'Node.js'
  step 'Scanning for a supported Node.js runtime.'
  log 'Scanning for a supported Node.js runtime'

  if scan_node; then
    ok "Node.js selected: $NODE_VERSION" "$NODE"
    log "Selected Node.js: $NODE_VERSION ($NODE)"
    return 0
  fi

  warn 'No supported Node.js runtime was found.' "Required: $NODE_REQUIREMENT"
  log 'No supported Node.js runtime was found'

  if have_brew; then
    step 'Installing Node.js via Homebrew.' 'brew install node'
    run_tee "$(brew_bin)" install node || warn 'Homebrew reported an error installing Node.js; re-scanning.'
    prepend_path /opt/homebrew/bin
    prepend_path /usr/local/bin
  else
    install_node_direct
  fi

  if scan_node; then
    ok "Node.js ready: $NODE_VERSION" "$NODE"
    log "Node.js ready: $NODE_VERSION ($NODE)"
    return 0
  fi

  die 'Node.js installation finished, but a supported runtime was not found. Open a new terminal and run this launcher again.'
}

# ── Git ──

# Resolve a working git without triggering the /usr/bin/git Command Line Tools
# install stub: prefer real binaries (brew/macports); only trust PATH/usr/bin when
# the Command Line Tools are actually installed (xcode-select -p succeeds).
resolve_git() {
  local c p
  for c in /opt/homebrew/bin/git /usr/local/bin/git /opt/local/bin/git; do
    if [ -x "$c" ] && "$c" --version >/dev/null 2>&1; then printf '%s' "$c"; return 0; fi
  done
  if xcode-select -p >/dev/null 2>&1; then
    if [ -x /usr/bin/git ] && /usr/bin/git --version >/dev/null 2>&1; then printf '%s' /usr/bin/git; return 0; fi
    p="$(command -v git 2>/dev/null || true)"
    if [ -n "$p" ] && "$p" --version >/dev/null 2>&1; then printf '%s' "$p"; return 0; fi
  fi
  return 1
}

git_present() { resolve_git >/dev/null 2>&1; }

install_git_clt() {
  step 'Requesting Xcode Command Line Tools install.' 'Accept the macOS dialog if it appears.'
  log 'Requesting Xcode Command Line Tools install'
  # xcode-select --install opens a GUI dialog and returns immediately; an
  # "already installed/in progress" error here is non-fatal.
  xcode-select --install >>"$LOG" 2>&1 || true

  local waited=0 max=1800
  while [ "$waited" -lt "$max" ]; do
    if git_present; then echo; return 0; fi
    sleep 5
    waited=$((waited + 5))
    printf '\r          %swaiting for Command Line Tools (%ss)...%s' "$C_GRAY" "$waited" "$C_RESET"
  done
  echo
}

ensure_git() {
  section 'Git'
  step 'Checking for Git.'
  log 'Checking for Git'

  if ! git_present; then
    warn 'Git was not found.'
    log 'Git was not found'
    if have_brew; then
      step 'Installing Git via Homebrew.' 'brew install git'
      run_tee "$(brew_bin)" install git || warn 'Homebrew reported an error installing Git.'
    else
      install_git_clt
    fi
  fi

  GIT="$(resolve_git || true)"
  [ -n "$GIT" ] || die 'Git installation did not complete. Finish the macOS Command Line Tools dialog, or run: xcode-select --install'

  prepend_path "$(dirname "$GIT")"
  ok "Git ready: $("$GIT" --version 2>/dev/null)" "$GIT"
  log "Git ready: $GIT"
}

# ── npm directories ──

prepare_npm_dirs() {
  section 'Environment'
  local dir
  for dir in "$NPM_PREFIX" "$NPM_CACHE"; do
    mkdir -p "$dir" 2>/dev/null || die "Failed to create directory: $dir"
    [ -d "$dir" ] || die "Directory was not created: $dir"
  done
  export npm_config_prefix="$NPM_PREFIX"
  export npm_config_cache="$NPM_CACHE"
  ok 'npm directories are ready.' "$NPM_PREFIX"
  log 'npm directories are ready'
}

# ── Package selection & install decision ──

select_package() {
  ls -1 "$SCRIPT_DIR/$APP_NAME"-*.tgz 2>/dev/null | sort -V | tail -1
}

pkg_version_from_name() {
  local v
  v="$(basename "$1")"
  v="${v#"$APP_NAME"-}"
  v="${v%.tgz}"
  printf '%s' "$v"
}

read_installed_version() {
  local v=''
  if [ -f "$APP_PKG" ]; then
    v="$(grep -m1 '"version"' "$APP_PKG" 2>/dev/null \
      | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  fi
  if [ -z "$v" ] && [ -f "$VERSION_MARKER" ]; then
    v="$(head -n1 "$VERSION_MARKER" 2>/dev/null | tr -d '[:space:]')"
  fi
  printf '%s' "$v"
}

# True (0) if an install/update is required.
need_install() {
  local pkg="$1" installed="$2" pkgver
  if [ ! -f "$APP_ENTRY" ]; then
    log 'decision: launcher is not installed -> install'
    return 0
  fi
  if [ -z "$pkg" ]; then
    log 'decision: no local package found -> use installed'
    return 1
  fi
  if [ -z "$installed" ]; then
    log 'decision: installed version unknown -> install'
    return 0
  fi
  pkgver="$(pkg_version_from_name "$pkg")"
  if [ "$pkgver" = "$installed" ]; then
    log "decision: installed $installed matches package -> skip"
    return 1
  fi
  if version_gt "$pkgver" "$installed"; then
    log "decision: package $pkgver newer than $installed -> install"
    return 0
  fi
  log "decision: package $pkgver not newer than $installed -> skip"
  return 1
}

install_launcher() {
  local pkg="$1" version
  [ -n "$pkg" ] || die "$APP_NAME is not installed and no $APP_NAME-*.tgz package was found next to the launcher: $SCRIPT_DIR"

  version="$(pkg_version_from_name "$pkg")"
  step "Installing $APP_NAME $version."
  kv 'Package' "$pkg"
  kv 'npm prefix' "$NPM_PREFIX"
  log "Installing package with npm: $pkg ($version)"

  if ! run_tee "$NPM" install \
    --prefix "$NPM_PREFIX" \
    --cache "$NPM_CACHE" \
    -g "$pkg" \
    --no-audit \
    --no-fund \
    --fetch-retries 2 \
    --fetch-retry-maxtimeout 20000 \
    --fetch-timeout 120000; then
    die "npm failed to install $APP_NAME. Check the log: $LOG"
  fi

  [ -f "$APP_ENTRY" ] || die "Installed launcher entry was not found: $APP_ENTRY"
  printf '%s\n' "$version" >"$VERSION_MARKER" 2>/dev/null || true
  ok "$APP_NAME installed." "Version $version"
  log "$APP_NAME installed successfully (version $version)"
}

# ── Launch ──

launch_app() {
  [ -f "$APP_ENTRY" ] || die "Installed launcher entry was not found: $APP_ENTRY"

  section 'Launch'
  step "Starting $APP_NAME."
  kv 'Node.js' "$NODE"
  kv 'Entry' "$APP_ENTRY"
  kv 'Working dir' "$APP_DIR"

  prepend_path "$NPM_PREFIX/bin"
  [ -n "$GIT" ] && prepend_path "$(dirname "$GIT")"
  local d
  for d in /opt/homebrew/bin /usr/local/bin; do
    [ -d "$d" ] && prepend_path "$d"
  done
  prepend_path "$(dirname "$NODE")"

  cd "$APP_DIR" 2>/dev/null || true
  log "Launching: $NODE $APP_ENTRY"

  # Let Ctrl+C reach the app (which resets INT to default on exec) without killing
  # this script, so the closing summary/pause still runs.
  trap ':' INT
  "$NODE" "$APP_ENTRY"
  APP_EXIT=$?
  trap - INT
  log "$APP_NAME exited with code $APP_EXIT"

  section 'Stopped'
  if [ "$APP_EXIT" -eq 0 ]; then
    ok "$APP_NAME exited with code 0."
  else
    warn "$APP_NAME exited with code $APP_EXIT."
  fi
  kv 'Log file' "$LOG"
}

# ── Self-test ──

self_test() {
  header
  section 'Self-test'
  [ -f "$SCRIPT_PATH" ] || die "Script path does not exist: $SCRIPT_PATH"
  ok 'Script path resolved.' "$SCRIPT_PATH"

  if version_gt '1.0.2' '1.0.1'; then ok 'Version comparison passed (1.0.2 > 1.0.1).'; else die 'Version comparison self-test failed.'; fi
  if version_gt '1.0.1' '1.0.2'; then die 'Reverse version comparison self-test failed.'; else ok 'Reverse version comparison rejected (1.0.1 not > 1.0.2).'; fi
  if version_gt '1.2.0' '1.1.9'; then ok 'Minor version comparison passed (1.2.0 > 1.1.9).'; else die 'Minor version comparison self-test failed.'; fi

  if node_supported 'v20.19.0' && node_supported 'v22.13.0' && node_supported 'v24.0.0' \
    && ! node_supported 'v18.20.0' && ! node_supported 'v20.18.9' && ! node_supported 'v22.12.0'; then
    ok 'Node.js version gate is correct.'
  else
    die 'Node.js version gate self-test failed.'
  fi

  local pkg
  pkg="$(select_package)"
  if [ -n "$pkg" ]; then
    ok 'Package discovery self-test passed.' "$(basename "$pkg")"
  else
    warn 'Package discovery self-test passed with no package found.'
  fi

  ok 'Launcher self-test completed.'
  return 0
}

# ── Main ──

pause_if_interactive() {
  [ "$SELF_TEST" = '1' ] && return 0
  if [ -t 0 ] && [ -t 1 ]; then
    printf '\n%sPress any key to close this window...%s' "$C_GRAY" "$C_RESET"
    IFS= read -r -n 1 -s _ 2>/dev/null || read -r _ 2>/dev/null || true
    echo
  fi
}

main() {
  init_paths
  start_log

  if [ "$SELF_TEST" = '1' ]; then
    self_test
    return $?
  fi

  header
  info 'This launcher checks prerequisites, installs or updates the packaged app, and starts it.'

  ensure_node
  ensure_git
  prepare_npm_dirs

  section 'Package'
  local pkg installed
  pkg="$(select_package)"
  if [ -n "$pkg" ]; then
    ok "Package found: $(basename "$pkg")" "Version $(pkg_version_from_name "$pkg")"
    log "Selected package: $pkg"
  else
    warn "No $APP_NAME-*.tgz package was found next to the launcher."
    log 'No package archive found next to launcher'
  fi

  installed="$(read_installed_version)"
  if [ -n "$installed" ]; then
    ok "Installed version: $installed"
  else
    warn 'Installed version could not be detected.'
  fi

  section 'Install decision'
  if need_install "$pkg" "$installed"; then
    install_launcher "$pkg"
  else
    ok 'Installed launcher is ready.'
  fi

  launch_app
}

trap pause_if_interactive EXIT
main "$@"
exit "$APP_EXIT"
