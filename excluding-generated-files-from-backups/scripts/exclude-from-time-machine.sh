#!/bin/bash
# Exclude regenerable folders (dependencies, build output, git internals) under the given roots
# from Time Machine. Time Machine has no name patterns, only per-path exclusions, so this finds
# the folders and gives each the same sticky exclusion `tmutil addexclusion` would (an xattr on
# the folder; no root needed).
# Rerun on a schedule: a folder that is deleted and recreated (rm -rf node_modules) loses it.
#
# Usage: exclude-from-time-machine.sh [--dry-run] [ROOT...]    (default root: ~/Projects)
#
# Written for /bin/bash 3.2 (the scheduler's PATH may not reach Homebrew's bash).
set -uo pipefail

# Always regenerable, wherever they appear.
ALWAYS=(node_modules .git venv .venv __pycache__ .next .nuxt .svelte-kit .turbo .expo
  .parcel-cache .nxcache .gradle DerivedData .codegraph .pytest_cache .mypy_cache .ruff_cache)
# Generic names that are sometimes real source: excluded only where git ignores them.
IF_IGNORED=(dist build out coverage target)
# Big, regenerable, and outside the roots. OrbStack's VM disk is excluded once by hand instead
# (see SKILL.md): its Group Container is unreadable from the Anima scheduler.
FIXED=("$HOME/Library/Developer")

XATTR=com.apple.metadata:com_apple_backup_excludeItem
# What `tmutil addexclusion` writes: a binary plist of the string "com.apple.backupd". Writing it
# directly takes ~2 ms; tmutil takes ~11 s per path while a backup is running.
STICKY=62706C69737430305F1011636F6D2E6170706C652E6261636B75706408000000000000010100000000000000010000000000000000000000000000001C

dry=""
if [ "${1:-}" = "--dry-run" ]; then dry=1; shift; fi
roots=("$@")
[ ${#roots[@]} -eq 0 ] && roots=("$HOME/Projects")

names=()
for n in "${ALWAYS[@]}" "${IF_IGNORED[@]}"; do names+=(-o -name "$n"); done
names=("${names[@]:1}")

is_generic() {
  local n
  for n in "${IF_IGNORED[@]}"; do [ "$1" = "$n" ] && return 0; done
  return 1
}

new=()
consider() {
  xattr -p "$XATTR" "$1" >/dev/null 2>&1 || new+=("$1")
}

for p in "${FIXED[@]}"; do [ -d "$p" ] && consider "$p"; done

found=0
while IFS= read -r -d '' dir; do
  found=$((found + 1))
  if is_generic "${dir##*/}"; then
    git -C "${dir%/*}" check-ignore -q "$dir" 2>/dev/null || continue
  fi
  consider "$dir"
done < <(find -x "${roots[@]}" -type d \( "${names[@]}" \) -print0 -prune 2>/dev/null)

echo "$(date '+%F %T') matched $found folders under ${roots[*]}; ${#new[@]} newly excluded"
[ ${#new[@]} -eq 0 ] && exit 0
if [ -n "$dry" ]; then
  printf '%s\n' "${new[@]}"
  exit 0
fi
failed=0
for dir in "${new[@]}"; do
  xattr -wx "$XATTR" "$STICKY" "$dir" 2>/dev/null || {
    echo "could not mark $dir (no access from this process? run: tmutil addexclusion '$dir')" >&2
    failed=$((failed + 1))
  }
done
[ "$failed" -eq 0 ]
