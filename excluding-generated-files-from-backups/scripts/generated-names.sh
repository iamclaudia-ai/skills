# shellcheck shell=bash
# Sourced by exclude-from-time-machine.sh and watch-generated-folders.sh (bash 3.2 safe).
# Keep NAMES in exclude-from-backblaze.py in step with ALWAYS.

# Always regenerable, wherever they appear.
ALWAYS=(node_modules .git venv .venv __pycache__ .next .nuxt .svelte-kit .turbo .expo
  .parcel-cache .nxcache .gradle DerivedData .codegraph .pytest_cache .mypy_cache .ruff_cache)
# Generic names that are sometimes real source: excluded only where git ignores them.
IF_IGNORED=(dist build out coverage target)

XATTR=com.apple.metadata:com_apple_backup_excludeItem
# What `tmutil addexclusion` writes: a binary plist of the string "com.apple.backupd". Writing it
# directly takes ~2 ms; tmutil takes ~11 s per path while a backup is running.
STICKY=62706C69737430305F1011636F6D2E6170706C652E6261636B75706408000000000000010100000000000000010000000000000000000000000000001C

in_list() {
  local needle="$1" n
  shift
  for n in "$@"; do [ "$needle" = "$n" ] && return 0; done
  return 1
}

# Succeeds when DIR should be excluded: an ALWAYS name, or an IF_IGNORED name git ignores.
should_exclude() {
  local name="${1##*/}"
  in_list "$name" "${ALWAYS[@]}" && return 0
  in_list "$name" "${IF_IGNORED[@]}" && git -C "${1%/*}" check-ignore -q "$1" 2>/dev/null
}

is_marked() { xattr -p "$XATTR" "$1" >/dev/null 2>&1; }
mark() { xattr -wx "$XATTR" "$STICKY" "$1" 2>/dev/null; }
