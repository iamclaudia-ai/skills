#!/usr/bin/env bash
# Attach screenshots to a PR description. Run from the repo root (my gh wrapper picks the account
# from the current directory).
#
#   pr-screenshots.sh <pr-number> <image>...
#
# GitHub has no API for the drag-and-drop uploads the web editor does, so the images live on an
# orphan branch, `pr-screenshots`, under `pr-<N>/`. That branch shares no history with main and is
# never merged or deployed. Prints one markdown image line per file, to paste into the PR body.
# `blob/...?raw=true` URLs render inline for anyone who can see the repo, private repos included
# (raw.githubusercontent.com URLs do not, for a private repo).
#
# Re-uploading a file with the same name replaces it, so a refreshed screenshot keeps its URL.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: pr-screenshots.sh <pr-number> <image>..." >&2
  exit 2
fi
pr=$1
shift
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
branch=pr-screenshots
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# First use in a repo: start the orphan branch with a README saying what it is.
if ! gh api "repos/$repo/branches/$branch" >/dev/null 2>&1; then
  blob=$(gh api "repos/$repo/git/blobs" \
    -f content="Screenshots referenced from PR descriptions, one folder per PR (pr-<N>/). Never merged; not part of the code." \
    -f encoding=utf-8 -q .sha)
  tree=$(gh api "repos/$repo/git/trees" \
    -f 'tree[][path]=README.md' -f 'tree[][mode]=100644' -f 'tree[][type]=blob' -f "tree[][sha]=$blob" -q .sha)
  commit=$(gh api "repos/$repo/git/commits" -f message="chore: start the pr-screenshots branch" -f tree="$tree" -q .sha)
  gh api "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$commit" >/dev/null
  echo "created branch $branch in $repo" >&2
fi

for f in "$@"; do
  name=$(basename "$f")
  path="pr-$pr/$name"
  # The content goes in a JSON file, not an argument: a full-page PNG's base64 can pass ARG_MAX.
  base64 <"$f" | tr -d '\n' >"$work/b64"
  existing=$(gh api "repos/$repo/contents/$path?ref=$branch" -q .sha 2>/dev/null || true)
  jq -n --rawfile c "$work/b64" --arg m "chore: screenshot $name for #$pr" --arg b "$branch" --arg s "$existing" \
    '{message: $m, branch: $b, content: $c} + (if $s == "" then {} else {sha: $s} end)' >"$work/body.json"
  gh api -X PUT "repos/$repo/contents/$path" --input "$work/body.json" >/dev/null
  echo "![${name%.*}](https://github.com/$repo/blob/$branch/$path?raw=true)"
done
