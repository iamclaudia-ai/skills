#!/bin/bash
# Bootstrap a worktree that `anima session create_session --worktree` made: it does none of the handoff bootstrap.
# Usage: bootstrap-worktree.sh <worktree> <main checkout> [shared tmp subfolder ...]
# Links each named tmp/ subfolder from the main checkout (tmp/ itself often holds tracked .keep files, so it can't be a
# symlink), and seeds CodeGraph from main's index when there is one.
set -euo pipefail
worktree="$1"; main="$2"; shift 2

# create_session can return before the worktree exists; making folders in it first breaks `git worktree add`.
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
