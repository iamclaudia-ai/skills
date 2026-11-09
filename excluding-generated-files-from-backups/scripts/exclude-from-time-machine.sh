#!/bin/bash
# Exclude regenerable folders (dependencies, build output, git internals) under the given roots
# from Time Machine. Time Machine has no name patterns, only per-path exclusions, so this finds
# the folders and gives each the same sticky exclusion `tmutil addexclusion` would (an xattr on
# the folder; no root needed). watch-generated-folders.sh marks new folders as they appear; this
# daily sweep catches anything it missed.
#
# Usage: exclude-from-time-machine.sh [--dry-run] [ROOT...]    (default root: ~/Projects)
#
# Written for /bin/bash 3.2 (the scheduler's PATH may not reach Homebrew's bash).
set -uo pipefail
# shellcheck source-path=SCRIPTDIR source=generated-names.sh
. "$(dirname "$0")/generated-names.sh"

# Big, regenerable, and outside the roots. OrbStack's VM disk is excluded once by hand instead
# (see SKILL.md): its Group Container is unreadable from the Anima scheduler.
FIXED=("$HOME/Library/Developer")

dry=""
if [ "${1:-}" = "--dry-run" ]; then dry=1; shift; fi
roots=("$@")
[ ${#roots[@]} -eq 0 ] && roots=("$HOME/Projects")

names=()
for n in "${ALWAYS[@]}" "${IF_IGNORED[@]}"; do names+=(-o -name "$n"); done
names=("${names[@]:1}")

new=()
for p in "${FIXED[@]}"; do [ -d "$p" ] && ! is_marked "$p" && new+=("$p"); done

found=0
while IFS= read -r -d '' dir; do
  found=$((found + 1))
  should_exclude "$dir" && ! is_marked "$dir" && new+=("$dir")
done < <(find -x "${roots[@]}" -type d \( "${names[@]}" \) -print0 -prune 2>/dev/null)

echo "$(date '+%F %T') matched $found folders under ${roots[*]}; ${#new[@]} newly excluded"
[ ${#new[@]} -eq 0 ] && exit 0
if [ -n "$dry" ]; then
  printf '%s\n' "${new[@]}"
  exit 0
fi

failed=0
for dir in "${new[@]}"; do
  mark "$dir" || {
    echo "could not mark $dir (no access from this process? run: tmutil addexclusion '$dir')" >&2
    failed=$((failed + 1))
  }
done
[ "$failed" -eq 0 ]
