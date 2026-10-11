#!/bin/sh
# Installe le build local de RecoltOS dans /Applications (QA §8.6).
# Prérequis : `pnpm run dist` (ou `pnpm run pack`) a produit dist/mac-arm64/RecoltOS.app.
# Variables : RECOLTOS_INSTALL_DIR (défaut /Applications ; relatif = depuis le dossier d'appel),
# RECOLTOS_NO_OPEN=1 (n'ouvre pas l'app).
# Ordre : la source et la copie sont vérifiées AVANT de toucher à l'app installée ; l'ancienne app
# n'est remplacée qu'après une copie valide, par deux renommages sur le même volume.
# Les données (~/Library/Application Support/RecoltOS) ne sont JAMAIS touchées.
set -eu

# Teste si l'app installée à $DST tourne (correspondance littérale du chemin, pas une regex).
running_from_dst() {
  ps -axww -o command= | grep -F -- "$DST/Contents/MacOS/RecoltOS" | grep -v -F -- grep >/dev/null 2>&1
}

# Résout la destination depuis le dossier d'appel, avant le cd vers la racine du dépôt.
DEST_DIR="${RECOLTOS_INSTALL_DIR:-/Applications}"
case "$DEST_DIR" in
  /*) ;;
  *) DEST_DIR="$(pwd)/$DEST_DIR" ;;
esac

cd "$(dirname "$0")/.."
SRC="dist/mac-arm64/RecoltOS.app"
DST="$DEST_DIR/RecoltOS.app"

if [ ! -d "$SRC" ]; then
  echo "install-local : $SRC introuvable. Lance d'abord : pnpm run dist" >&2
  exit 1
fi
mkdir -p "$DEST_DIR"

# Copie de travail dans le dossier de destination (même volume : renommage atomique ensuite).
STAGE="$DEST_DIR/.RecoltOS.app.new.$$"
BACKUP="$DEST_DIR/.RecoltOS.app.old.$$"
rm -rf "$STAGE"
# Nettoyage sur sortie, y compris interruption : la copie de travail disparaît, et si l'ancienne app a été
# mise de côté ($BACKUP) sans que la nouvelle soit en place ($DST absent), elle est restaurée.
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
# Une copie faite par ditto n'est pas en quarantaine ; cette commande couvre une copie qui a voyagé.
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true

# Vérifications sur la copie AVANT de toucher à l'app existante : en cas d'échec, l'ancienne reste en place.
if ! codesign --verify --deep --strict --verbose=1 "$STAGE"; then
  echo "install-local : la signature de $SRC est invalide ; $DST est inchangé." >&2
  exit 1
fi
# Identité explicite demandée : l'exigence désignée doit s'appuyer sur le certificat, pas sur un cdhash
# (electron-builder peut produire un build ad hoc en silence si l'identité est introuvable).
# Critère « certificate leaf » : correct pour un auto-signé et pour Apple Development (certificate leaf[subject.CN]),
# mais NON encore prouvé avec le vrai certificat « RecoltOS Local » : à valider en WP-0F (docs/spikes/s2-signature.md).
if [ -n "${RECOLTOS_SIGN_IDENTITY:-}" ] && [ "${RECOLTOS_SIGN_IDENTITY}" != "-" ]; then
  if ! codesign -dr - "$STAGE" 2>&1 | grep -q "certificate leaf"; then
    echo "install-local : RECOLTOS_SIGN_IDENTITY est défini mais le build est en signature ad hoc (cdhash)." >&2
    echo "  Vérifie le certificat : security find-identity -v -p codesigning (voir docs/signature.md)." >&2
    echo "  $DST est inchangé." >&2
    exit 1
  fi
fi

# Quitte l'instance installée et attend sa disparition (pas de sleep fixe : la fermeture peut prendre du temps).
if [ -d "$DST" ]; then
  if [ "$DEST_DIR" = "/Applications" ]; then
    osascript -e 'tell application id "com.recoltos.app" to quit' 2>/dev/null || true
  fi
  i=0
  while running_from_dst; do
    i=$((i + 1))
    if [ "$i" -ge 20 ]; then
      echo "install-local : RecoltOS tourne toujours depuis $DST après 10 s ; ferme-le puis relance." >&2
      echo "  $DST est inchangé." >&2
      exit 1
    fi
    sleep 0.5
  done
fi

# Remplacement : l'ancienne app est mise de côté, puis restaurée si le renommage final échoue.
if [ -d "$DST" ]; then
  mv "$DST" "$BACKUP"
fi
if ! mv "$STAGE" "$DST"; then
  if [ -d "$BACKUP" ]; then
    mv "$BACKUP" "$DST"
  fi
  echo "install-local : installation impossible dans $DST ; l'ancienne version a été restaurée." >&2
  exit 1
fi
rm -rf "$BACKUP"
echo "RecoltOS installé : $DST"

if [ "${RECOLTOS_NO_OPEN:-0}" != "1" ]; then
  open "$DST"
fi
