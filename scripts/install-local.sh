#!/bin/sh
# Installs the local RecoltOS build into /Applications.
# Prerequisite: `pnpm run dist` (or `pnpm run pack`) has produced dist/mac-arm64/RecoltOS.app.
# Variables: RECOLTOS_INSTALL_DIR (default /Applications; relative = from the calling directory),
# RECOLTOS_NO_OPEN=1 (does not open the app).
# Order: the source and the copy are verified BEFORE touching the installed app; the old app
# is only replaced after a valid copy, via two renames on the same volume.
# The data (~/Library/Application Support/RecoltOS) is NEVER touched.
set -eu

# Test guard: under Vitest or NODE_ENV=test, the installation must target an explicit folder (never
# /Applications by default) and must not open the app. Avoids relaunching the packaged app without
# RECOLTOS_USER_DATA.
if [ -n "${VITEST:-}" ] || [ "${NODE_ENV:-}" = "test" ]; then
  if [ -z "${RECOLTOS_INSTALL_DIR:-}" ]; then
    echo "install-local: refused under test without RECOLTOS_INSTALL_DIR (no /Applications from a test)." >&2
    exit 2
  fi
  RECOLTOS_NO_OPEN="${RECOLTOS_NO_OPEN:-1}"
fi

# Tests whether the app installed at $DST is running (literal path match, not a regex).
running_from_dst() {
  ps -axww -o command= | grep -F -- "$DST/Contents/MacOS/RecoltOS" | grep -v -F -- grep >/dev/null 2>&1
}

# Resolves the destination from the calling directory, before cd-ing to the repository root.
DEST_DIR="${RECOLTOS_INSTALL_DIR:-/Applications}"
case "$DEST_DIR" in
  /*) ;;
  *) DEST_DIR="$(pwd)/$DEST_DIR" ;;
esac

cd "$(dirname "$0")/.."
SRC="dist/mac-arm64/RecoltOS.app"
DST="$DEST_DIR/RecoltOS.app"

if [ ! -d "$SRC" ]; then
  echo "install-local: $SRC not found. Run first: pnpm run dist" >&2
  exit 1
fi
mkdir -p "$DEST_DIR"

# Working copy in the destination folder (same volume: atomic rename afterwards).
STAGE="$DEST_DIR/.RecoltOS.app.new.$$"
BACKUP="$DEST_DIR/.RecoltOS.app.old.$$"
rm -rf "$STAGE"
# Cleanup on exit, including interruption: the working copy is removed, and if the old app was
# set aside ($BACKUP) without the new one being in place ($DST missing), it is restored.
cleanup() {
  rm -rf "$STAGE"
  if [ -d "$BACKUP" ] && [ ! -e "$DST" ]; then
    mv "$BACKUP" "$DST" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ditto "$SRC" "$STAGE"
# A copy made by ditto is not quarantined; this command covers a copy that has travelled.
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true

# Checks on the copy BEFORE touching the existing app: on failure, the old one stays in place.
if ! codesign --verify --deep --strict --verbose=1 "$STAGE"; then
  echo "install-local: the signature of $SRC is invalid; $DST is unchanged." >&2
  exit 1
fi
# Explicit identity requested: the designated requirement must rely on the certificate, not on a cdhash
# (electron-builder may silently produce an ad hoc build if the identity is not found).
# "certificate leaf" criterion: correct for a self-signed certificate and for Apple Development (certificate leaf[subject.CN]).
if [ -n "${RECOLTOS_SIGN_IDENTITY:-}" ] && [ "${RECOLTOS_SIGN_IDENTITY}" != "-" ]; then
  if ! codesign -dr - "$STAGE" 2>&1 | grep -q "certificate leaf"; then
    echo "install-local: RECOLTOS_SIGN_IDENTITY is set but the build is ad hoc signed (cdhash)." >&2
    echo "  Check the certificate: security find-identity -v -p codesigning (see docs/signature.md)." >&2
    echo "  $DST is unchanged." >&2
    exit 1
  fi
fi

# Quits the installed instance and waits for it to disappear (no fixed sleep: closing may take time).
if [ -d "$DST" ]; then
  if [ "$DEST_DIR" = "/Applications" ]; then
    osascript -e 'tell application id "com.recoltos.app" to quit' 2>/dev/null || true
  fi
  i=0
  while running_from_dst; do
    i=$((i + 1))
    if [ "$i" -ge 20 ]; then
      echo "install-local: RecoltOS is still running from $DST after 10 s; close it and retry." >&2
      echo "  $DST is unchanged." >&2
      exit 1
    fi
    sleep 0.5
  done
fi

# Replacement: the old app is set aside, then restored if the final rename fails.
if [ -d "$DST" ]; then
  mv "$DST" "$BACKUP"
fi
if ! mv "$STAGE" "$DST"; then
  if [ -d "$BACKUP" ]; then
    mv "$BACKUP" "$DST"
  fi
  echo "install-local: installation into $DST failed; the old version was restored." >&2
  exit 1
fi
rm -rf "$BACKUP"
echo "RecoltOS installed: $DST"

if [ "${RECOLTOS_NO_OPEN:-0}" != "1" ]; then
  open "$DST"
fi
