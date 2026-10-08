#!/usr/bin/env bash
# seam-check.sh — verify seamlessness BEFORE touching the wallpaper.
# Reconstructs the physical desk: each display's crop composited back onto a black
# canvas at its true position, with monitor edges outlined. If the crops are right,
# the horizon (and every line) runs unbroken across the covered regions; black areas
# are just gaps no monitor covers. Writes a preview PNG and prints its path.
#
# Usage: seam-check.sh <canvas.jpg> [out.png] [name_substr=WxH+X+Y ...overrides]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SWIFT="$HERE/displays.swift"

SRC=""; OUT=""
declare -a OV_NAME=() OV_GEOM=()
for a in "$@"; do
  case "$a" in
    *=*x*+*+*) OV_NAME+=("${a%%=*}"); OV_GEOM+=("${a#*=}") ;;
    *) if [ -z "$SRC" ]; then SRC="$a"; elif [ -z "$OUT" ]; then OUT="$a"; fi ;;
  esac
done
[ -f "$SRC" ] || { echo "error: canvas not found: $SRC" >&2; exit 2; }
[ -n "$OUT" ] || OUT="${TMPDIR:-/tmp}/seam-check-$(date +%s).png"

BBOX="$(swift "$SWIFT" list 2>&1 1>/dev/null | sed -n 's/^bbox=//p')"
BW="${BBOX%x*}"; BH="${BBOX#*x}"
mapfile -t ROWS < <(swift "$SWIFT" list)

COLORS=(red green blue magenta cyan yellow orange)
ARGS=(-size "${BW}x${BH}" xc:black)
DRAW=()
ci=0
for row in "${ROWS[@]}"; do
  IFS=$'\t' read -r id name ox oy w h crop <<<"$row"
  geom="$crop"
  for k in "${!OV_NAME[@]}"; do [[ "$name" == *"${OV_NAME[$k]}"* ]] && geom="${OV_GEOM[$k]}"; done
  # geom = WxH+X+Y → extract X,Y,W,H
  wh="${geom%%+*}"; xy="${geom#*+}"; X="${xy%%+*}"; Y="${xy#*+}"; W="${wh%x*}"; H="${wh#*x}"
  tmp="${TMPDIR:-/tmp}/.seam-${id}.png"
  magick "$SRC" -crop "$geom" +repage "$tmp"
  ARGS+=("$tmp" -geometry "+${X}+${Y}" -composite)
  col="${COLORS[$((ci % ${#COLORS[@]}))]}"; ci=$((ci+1))
  DRAW+=(-stroke "$col" -draw "rectangle $X,$Y $((X+W-1)),$((Y+H-1))")
done

magick "${ARGS[@]}" -strokewidth 6 -fill none "${DRAW[@]}" -resize 1920x "$OUT"
echo "seam preview -> $OUT"
