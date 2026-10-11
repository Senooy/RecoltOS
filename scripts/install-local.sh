#!/bin/sh
# Installe le build local de RecoltOS dans /Applications (QA §8.6).
# Prérequis : `pnpm run dist` (ou `pnpm run pack`) a produit dist/mac-arm64/RecoltOS.app.
# Variables : RECOLTOS_INSTALL_DIR (défaut /Applications), RECOLTOS_NO_OPEN=1 (n'ouvre pas l'app).
# Les données (~/Library/Application Support/RecoltOS) ne sont JAMAIS touchées.
set -eu
cd "$(dirname "$0")/.."
SRC="dist/mac-arm64/RecoltOS.app"
DEST_DIR="${RECOLTOS_INSTALL_DIR:-/Applications}"
DST="$DEST_DIR/RecoltOS.app"

if [ ! -d "$SRC" ]; then
  echo "install-local : $SRC introuvable. Lance d'abord : pnpm run dist" >&2
  exit 1
fi
mkdir -p "$DEST_DIR"

# Quitte proprement une instance installée (seulement celle de l'installation visée).
if [ -d "$DST" ] && [ "$DEST_DIR" = "/Applications" ]; then
  osascript -e 'tell application id "com.recoltos.app" to quit' 2>/dev/null || true
  sleep 1
fi

rm -rf "$DST"
ditto "$SRC" "$DST"
# Une copie faite par ditto n'est pas en quarantaine ; cette commande couvre une copie qui a voyagé.
xattr -dr com.apple.quarantine "$DST" 2>/dev/null || true
codesign --verify --deep --strict --verbose=2 "$DST"
echo "RecoltOS installé : $DST"

if [ "${RECOLTOS_NO_OPEN:-0}" != "1" ]; then
  open "$DST"
fi
