#!/usr/bin/env bash
# carve-and-apply.sh — slice one prepared wallpaper canvas into per-display crops
# at each display's TRUE physical position, then set each as that display's wallpaper.
#
# The result is a single image spanning all monitors *seamlessly* (the horizon
# and every edge line up across the desk), because each crop is just that
# monitor's window into the one big canvas.
#
# Usage:
#   carve-and-apply.sh <canvas.jpg> [out-dir] [name_substr=WxH+X+Y ...] [--no-set] [--resize]
#
#   <canvas.jpg>   Prepared canvas. Should already equal the display arrangement's
#                  bounding box (see `list-displays.sh`). Prepare framing editorially
#                  in an image editor first — this script does NOT make taste calls.
#   [out-dir]      Where crops are written (default: the canvas's folder).
#   name_substr=GEOM   Override a display's crop by (case-sensitive) name substring.
#                  Use for a screen that is physically SEPARATED from the others
#                  (e.g. a teleprompter mounted with a gap) where the seamless
#                  position isn't what you want. GEOM is ImageMagick crop geometry.
#                  Example: "Elgato=1024x600+3600+405"
#   --no-set       Carve only; don't change the wallpaper.
#   --resize       If the canvas != bbox, resize-cover it to bbox first (WARNING:
#                  this re-crops your framing; prefer preparing the canvas exactly).
#
# Requires: ImageMagick (`magick`), Swift (Xcode CLT). macOS only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SWIFT="$HERE/displays.swift"

SRC=""; OUTDIR=""; NO_SET=0; RESIZE=0
declare -a OV_NAME=() OV_GEOM=()
for a in "$@"; do
  case "$a" in
    --no-set) NO_SET=1 ;;
    --resize) RESIZE=1 ;;
    *=*x*+*+*) OV_NAME+=("${a%%=*}"); OV_GEOM+=("${a#*=}") ;;   # name=WxH+X+Y
    *) if [ -z "$SRC" ]; then SRC="$a"; elif [ -z "$OUTDIR" ]; then OUTDIR="$a"; fi ;;
  esac
done
[ -n "$SRC" ] || { echo "error: no canvas given" >&2; exit 2; }
[ -f "$SRC" ] || { echo "error: canvas not found: $SRC" >&2; exit 2; }
[ -n "$OUTDIR" ] || OUTDIR="$(cd "$(dirname "$SRC")" && pwd)"
mkdir -p "$OUTDIR"

TS="$(date +%Y%m%d-%H%M%S)"   # macOS caches wallpaper by path → unique filename each run

# --- canvas dims ---
read -r CW CH < <(sips -g pixelWidth -g pixelHeight "$SRC" | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w, h}')

# --- display list (+ bbox on stderr) ---
BBOX="$(swift "$SWIFT" list 2>&1 1>/dev/null | sed -n 's/^bbox=//p')"
mapfile -t ROWS < <(swift "$SWIFT" list)
BW="${BBOX%x*}"; BH="${BBOX#*x}"
echo "canvas ${CW}x${CH}  |  arrangement bbox ${BW}x${BH}  |  ${#ROWS[@]} displays"

# --- reconcile canvas size with the arrangement bounding box ---
CANVAS="$SRC"
if [ "$CW" != "$BW" ] || [ "$CH" != "$BH" ]; then
  if [ "$RESIZE" = 1 ]; then
    CANVAS="$OUTDIR/.canvas-${BW}x${BH}-${TS}.jpg"
    echo "⚠️  resizing canvas to ${BW}x${BH} (cover+center crop) → $CANVAS"
    magick "$SRC" -resize "${BW}x${BH}^" -gravity center -extent "${BW}x${BH}" "$CANVAS"
  else
    echo "error: canvas ${CW}x${CH} != bbox ${BW}x${BH}." >&2
    echo "       Prepare the canvas at ${BW}x${BH}, or pass --resize to cover-crop it." >&2
    exit 1
  fi
fi

# --- carve each display + build the id→file map for the setter ---
declare -a MAP=()
for row in "${ROWS[@]}"; do
  IFS=$'\t' read -r id name ox oy w h crop <<<"$row"
  geom="$crop"
  for k in "${!OV_NAME[@]}"; do
    [[ "$name" == *"${OV_NAME[$k]}"* ]] && geom="${OV_GEOM[$k]}"
  done
  safe="$(printf '%s' "$name" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-//; s/-$//')"
  rm -f "$OUTDIR/${safe}-"*.jpg 2>/dev/null || true   # drop this display's prior timestamps
  out="$OUTDIR/${safe}-${TS}.jpg"
  magick "$CANVAS" -crop "$geom" +repage "$out"
  printf '  carved  %-16s %-22s -> %s\n' "$name" "$geom" "${out##*/}"
  MAP+=("$id" "$out")
done

if [ "$NO_SET" = 1 ]; then
  echo "done (carve only; --no-set)."
else
  echo "--- applying ---"
  swift "$SWIFT" set "${MAP[@]}"
fi
