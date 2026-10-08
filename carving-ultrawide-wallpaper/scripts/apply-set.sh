#!/usr/bin/env bash
# apply-set.sh — apply a saved wallpaper set by folder name (or path).
#
# A "set" is a folder holding a prepared canvas plus `wallpaper-set.conf`, which
# records the canvas filename and per-display overrides. `carve-and-apply.sh`
# writes that conf on every run, so applying a set once makes it replayable:
# swap wallpapers (or recover after a reboot / cache miss) with a single word.
#
# Usage:
#   apply-set.sh <folder-name-or-path> [--no-set]
#     <folder>   A subfolder of $WALLPAPER_DIR (default ~/Pictures/wallpaper),
#                or an absolute/relative path to a set folder.
#     --no-set   Carve only; don't change the wallpaper (passed through).
#
# If a set has no conf yet, the canvas is auto-detected (the .jpg beside a .psd,
# else the only .jpg that isn't a carved output) and applied with NO overrides —
# run `apply` once with your override to record the recipe.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${WALLPAPER_DIR:-$HOME/Pictures/wallpaper}"

ARG="${1:?usage: apply-set <folder-name-or-path> [--no-set]}"; shift || true

# resolve the set folder
if [ -d "$ARG" ]; then DIR="$(cd "$ARG" && pwd)"
elif [ -d "$BASE/$ARG" ]; then DIR="$(cd "$BASE/$ARG" && pwd)"
else echo "error: no set folder '$ARG' (looked for it, and in '$BASE/$ARG')" >&2; exit 2; fi

CONF="$DIR/wallpaper-set.conf"
CANVAS=""
declare -a OVERRIDES=()

if [ -f "$CONF" ]; then
  # shellcheck disable=SC1090
  source "$CONF"
else
  echo "⚠️  no wallpaper-set.conf in $DIR — detecting canvas, applying with no overrides" >&2
  shopt -s nullglob
  for p in "$DIR"/*.psd; do c="${p%.psd}.jpg"; [ -f "$c" ] && CANVAS="$(basename "$c")" && break; done
  if [ -z "$CANVAS" ]; then
    for j in "$DIR"/*.jpg; do
      b="$(basename "$j")"
      [[ "$b" =~ -[0-9]{8}-[0-9]{6}\.jpg$ ]] && continue   # skip carved outputs
      CANVAS="$b"; break
    done
  fi
  [ -n "$CANVAS" ] || { echo "error: couldn't find a source canvas in $DIR" >&2; exit 2; }
fi

[ -f "$DIR/$CANVAS" ] || { echo "error: canvas not found: $DIR/$CANVAS" >&2; exit 2; }

echo "set:      $DIR"
echo "canvas:   $CANVAS"
[ ${#OVERRIDES[@]} -gt 0 ] && echo "overrides: ${OVERRIDES[*]}"
echo

if [ ${#OVERRIDES[@]} -gt 0 ]; then
  exec "$HERE/carve-and-apply.sh" "$DIR/$CANVAS" "$DIR" "${OVERRIDES[@]}" "$@"
else
  exec "$HERE/carve-and-apply.sh" "$DIR/$CANVAS" "$DIR" "$@"
fi
