#!/bin/bash
# Bootstrap a worktree made with `git worktree add`, before pointing `anima session create_session --cwd` at it.
# Usage: bootstrap-worktree.sh <worktree> <main checkout> [shared tmp subfolder ...]
# Links each named tmp/ subfolder from the main checkout (tmp/ itself often holds tracked .keep files, so it can't be a
# symlink), and seeds CodeGraph from main's index when there is one.
set -euo pipefail
worktree="$1"; main="$2"; shift 2

# Never run this on a path create_session --worktree is still setting up: making folders first breaks its setup.
for _ in $(seq 60); do [ -e "$worktree/.git" ] && break; sleep 2; done
[ -e "$worktree/.git" ] || { echo "no worktree at $worktree; create it with git worktree add first" >&2; exit 1; }

mkdir -p "$worktree/tmp"
for folder in "$@"; do
  [ -e "$worktree/tmp/$folder" ] || ln -s "$main/tmp/$folder" "$worktree/tmp/$folder"
done

if [ -f "$main/.codegraph/codegraph.db" ] && [ ! -f "$worktree/.codegraph/codegraph.db" ]; then
  mkdir -p "$worktree/.codegraph"
  sqlite3 "$main/.codegraph/codegraph.db" ".backup '$worktree/.codegraph/codegraph.db'"
  (cd "$worktree" && codegraph sync > /dev/null)
fi
echo "bootstrapped $worktree"
