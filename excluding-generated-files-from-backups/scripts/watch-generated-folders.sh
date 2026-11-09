#!/bin/bash
# Mark generated folders (node_modules, .git, gitignored dist...) as Time Machine exclusions the
# moment they are created, so an hourly backup never catches a fresh `pnpm install` in a new
# worktree. Runs under launchd (see SKILL.md); uses FSEvents through fswatch.
#
# Usage: watch-generated-folders.sh [ROOT...]    (default root: ~/Projects)
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
# shellcheck source-path=SCRIPTDIR source=generated-names.sh
. "$(dirname "$0")/generated-names.sh"

roots=("$@")
[ ${#roots[@]} -eq 0 ] && roots=("$HOME/Projects")

# fswatch matches -i/-e against the full path; only paths ending in a watched name get through.
all=("${ALWAYS[@]}" "${IF_IGNORED[@]}")
pattern="$(printf '%s|' "${all[@]}" | sed 's/\./\\./g; s/|$//')"
nested="/($(printf '%s|' "${ALWAYS[@]}" | sed 's/\./\\./g; s/|$//'))/"

echo "$(date '+%F %T') watching ${roots[*]}"
fswatch -r -l 1 --event Created --event Renamed --event-flag-separator=, --format '%f %p' \
  -E -e '.*' -i "/($pattern)\$" "${roots[@]}" |
  while IFS= read -r record; do
    dir="${record#* }"
    # Inside a folder that is already excluded: the whole subtree is out of the backup.
    [[ "${dir%/*}/" =~ $nested ]] && continue
    [ -d "$dir" ] || continue
    should_exclude "$dir" || continue
    is_marked "$dir" && continue
    if mark "$dir"; then
      echo "$(date '+%F %T') excluded $dir"
    else
      echo "$(date '+%F %T') could not mark $dir" >&2
    fi
  done
