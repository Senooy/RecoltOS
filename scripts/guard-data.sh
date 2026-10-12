#!/bin/sh
# Data guard: fails if the git-tracked repository contains a database, user settings,
# a secret, or a file that does not belong there. `pnpm run guard` (inside `verify`).
#   - prefs.json, window-state.json, *.db, *.db-wal, *.db-shm, *.db-journal, *.sqlite, *.sqlite3,
#     *.bak, case-insensitive (user databases and settings; APFS does not distinguish
#     `DATA.DB` from `data.db`);
#   - secrets: .env, .env.*, *.pem, *.key, *.p12, *.p8, *.cer, *.mobileprovision, and any PEM
#     private key ("BEGIN … PRIVATE KEY") in the tracked content;
#   - files over 2 MB outside the allowlist.
# FAIL CLOSED: outside a git repo, or if git fails (safe.directory, corrupt index...), the guard
# exits with an error instead of concluding "OK" on an empty list. `git grep`: code 1 = no result
# (normal), code > 1 = real error.
# GUARD_ROOT=<dir> to target another repository (tests).
set -eu

ROOT="${GUARD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

# The pattern is assembled so that this script does not flag itself.
PEM_KEY="BEGIN ([A-Z]+ )?PRIVATE"" KEY"
MAX_BYTES=2097152

fail=0
report() {
  echo "guard : $1" >&2
  fail=1
}
abort() {
  echo "guard : $1" >&2
  echo "guard : FAILED (guard cannot run: refused as a precaution)" >&2
  exit 1
}

# The target directory must BE the root of a git repository (not an untracked subfolder of another
# repository, whose `git ls-files` would be empty).
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || abort "$ROOT is not in a usable git repository"
HERE="$(pwd -P)"
[ "$(cd "$TOP" && pwd -P)" = "$HERE" ] || abort "$HERE is not the root of a git repository (root: $TOP)"

LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
git ls-files -z > "$LIST" 2>/dev/null || abort "git ls-files failed"
FILES="$(tr '\0' '\n' < "$LIST")"

# 1. User databases and settings.
# Case-insensitive: APFS is by default (`DATA.DB` = `data.db`).
bad_names="$(printf '%s\n' "$FILES" | grep -Ei '(^|/)prefs\.json$|(^|/)window-state\.json$|\.db$|\.db-wal$|\.db-shm$|\.db-journal$|\.sqlite3?$|\.bak$' || true)"
if [ -n "$bad_names" ]; then
  report "data file(s) tracked by git:"
  printf '%s\n' "$bad_names" | sed 's/^/    /' >&2
fi

# 2. Secret files.
bad_secrets="$(printf '%s\n' "$FILES" | grep -Ei '(^|/)\.env(\..*)?$|\.(pem|key|p12|p8|cer|mobileprovision)$' || true)"
if [ -n "$bad_secrets" ]; then
  report "secret file(s) tracked by git:"
  printf '%s\n' "$bad_secrets" | sed 's/^/    /' >&2
fi

# 3. Large files (allowlist: internal visual snapshots and the icon).
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
    $f ($size bytes)"; fi
done
IFS="$OLD_IFS"
if [ -n "$big" ]; then
  report "file(s) over 2 MB outside the allowlist:$big"
fi

# 4. Content: PEM private key.
grep_rc=0
hits="$(git grep -I -l -E -e "$PEM_KEY" -- . 2>/dev/null)" || grep_rc=$?
if [ "$grep_rc" -gt 1 ]; then
  abort "git grep failed (code $grep_rc)"
fi
if [ -n "$hits" ]; then
  report "private key(s) in tracked content:"
  printf '%s\n' "$hits" | sed 's/^/    /' >&2
fi

if [ "$fail" -ne 0 ]; then
  echo "guard : FAILED (data or secrets tracked by git)" >&2
  exit 1
fi
echo "guard : OK (no database, user settings or secrets tracked)"
