#!/bin/sh
# Converts build/icon.png (1024×1024) to build/icon.icns (macOS: sips + iconutil, no third-party tool).
# Can be run from anywhere: `pnpm run icon` (make-icon.mts, then this script).
set -eu
cd "$(dirname "$0")/.."
SRC=build/icon.png
SET=build/icon.iconset
[ -f "$SRC" ] || { echo "make-icns: $SRC not found (run make-icon.mts first)" >&2; exit 1; }
rm -rf "$SET"
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o build/icon.icns
rm -rf "$SET"
echo "icon generated: build/icon.icns"
