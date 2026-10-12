#!/bin/sh
# Garde des données : échoue si le dépôt suivi par git contient une base, des réglages utilisateur,
# un secret ou un fichier qui n'a rien à y faire. `pnpm run guard` (dans `verify`).
#   - prefs.json, window-state.json, *.db, *.db-wal, *.db-shm, *.db-journal, *.sqlite, *.sqlite3,
#     *.bak, insensible à la casse (bases et réglages de l'utilisateur ; APFS ne distingue pas
#     `DATA.DB` de `data.db`) ;
#   - secrets : .env, .env.*, *.pem, *.key, *.p12, *.p8, *.cer, *.mobileprovision, et toute clé
#     privée PEM (« BEGIN … PRIVATE KEY ») dans le contenu suivi ;
#   - fichier de plus de 2 Mo hors liste blanche.
# Échec FERMÉ : hors dépôt git, ou si git échoue (safe.directory, index corrompu…), la garde sort en
# erreur au lieu de conclure « OK » sur une liste vide. `git grep` : code 1 = aucun résultat (normal),
# code > 1 = vraie erreur.
# GUARD_ROOT=<dossier> pour viser un autre dépôt (tests).
set -eu

ROOT="${GUARD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

# Le motif est assemblé pour que ce script ne se dénonce pas lui-même.
PEM_KEY="BEGIN ([A-Z]+ )?PRIVATE"" KEY"
MAX_BYTES=2097152

fail=0
report() {
  echo "guard : $1" >&2
  fail=1
}
abort() {
  echo "guard : $1" >&2
  echo "guard : ÉCHEC (garde impossible à exécuter : refus par prudence)" >&2
  exit 1
}

# Le dossier visé doit être LA racine d'un dépôt git (pas un sous-dossier non versionné d'un autre
# dépôt, dont `git ls-files` serait vide).
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || abort "$ROOT n'est pas dans un dépôt git exploitable"
HERE="$(pwd -P)"
[ "$(cd "$TOP" && pwd -P)" = "$HERE" ] || abort "$HERE n'est pas la racine d'un dépôt git (racine : $TOP)"

LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
git ls-files -z > "$LIST" 2>/dev/null || abort "git ls-files a échoué"
FILES="$(tr '\0' '\n' < "$LIST")"

# 1. Bases et réglages de l'utilisateur.
# Insensible à la casse : APFS l'est par défaut (`DATA.DB` = `data.db`).
bad_names="$(printf '%s\n' "$FILES" | grep -Ei '(^|/)prefs\.json$|(^|/)window-state\.json$|\.db$|\.db-wal$|\.db-shm$|\.db-journal$|\.sqlite3?$|\.bak$' || true)"
if [ -n "$bad_names" ]; then
  report "fichier(s) de données suivi(s) par git :"
  printf '%s\n' "$bad_names" | sed 's/^/    /' >&2
fi

# 2. Fichiers de secrets.
bad_secrets="$(printf '%s\n' "$FILES" | grep -Ei '(^|/)\.env(\..*)?$|\.(pem|key|p12|p8|cer|mobileprovision)$' || true)"
if [ -n "$bad_secrets" ]; then
  report "fichier(s) de secrets suivi(s) par git :"
  printf '%s\n' "$bad_secrets" | sed 's/^/    /' >&2
fi

# 3. Fichiers volumineux (liste blanche : snapshots visuels internes et icône).
big=""
OLD_IFS="$IFS"
IFS='
'
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in
    tests/visual/__snapshots__/*|build/icon.icns|build/icon.png|pnpm-lock.yaml) continue ;;
  esac
  size="$(wc -c < "$f" | tr -d ' ')"
  if [ "$size" -gt "$MAX_BYTES" ]; then big="$big
    $f ($size octets)"; fi
done
IFS="$OLD_IFS"
if [ -n "$big" ]; then
  report "fichier(s) de plus de 2 Mo hors liste blanche :$big"
fi

# 4. Contenu : clé privée PEM.
grep_rc=0
hits="$(git grep -I -l -E -e "$PEM_KEY" -- . 2>/dev/null)" || grep_rc=$?
if [ "$grep_rc" -gt 1 ]; then
  abort "git grep a échoué (code $grep_rc)"
fi
if [ -n "$hits" ]; then
  report "clé(s) privée(s) dans le contenu suivi :"
  printf '%s\n' "$hits" | sed 's/^/    /' >&2
fi

if [ "$fail" -ne 0 ]; then
  echo "guard : ÉCHEC (données ou secrets suivis par git)" >&2
  exit 1
fi
echo "guard : OK (aucune base, aucun réglage utilisateur ni secret suivi)"
