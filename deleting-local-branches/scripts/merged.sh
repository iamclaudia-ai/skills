#!/usr/bin/env bash
# Run Michael's cleanup-local-branches in a repo. It deletes local branches whose
# PR was merged and skips open, draft, and closed-but-unmerged ones (unless --yes).
# The skills runner runs from the skill dir, so the repo comes first in argv.
#
# Usage: merged.sh <abs-repo-path> [cleanup-local-branches flags...]
set -euo pipefail

repo="${1:-}"
if [[ -z "$repo" || "$repo" == -* ]]; then
  echo "Usage: merged <abs-repo-path> [--dry-run] [--yes] [--prompt] [--open-pr] [--no-pr] [--archive] [--merged]" >&2
  exit 2
fi
shift

if [[ "$repo" != /* ]]; then
  echo "Error: the repo path must be absolute" >&2
  exit 2
fi
if ! command -v cleanup-local-branches >/dev/null 2>&1; then
  echo "Error: cleanup-local-branches is not on PATH (it lives in ~/dotfiles/scripts)" >&2
  exit 1
fi

# Not interactive under an agent: never let --prompt stall on read.
for arg in "$@"; do
  if [[ "$arg" == "--prompt" && ! -t 0 ]]; then
    echo "Error: --prompt needs a terminal. Use --dry-run, then --yes, instead." >&2
    exit 2
  fi
done

cd "$repo"
exec cleanup-local-branches "$@"
