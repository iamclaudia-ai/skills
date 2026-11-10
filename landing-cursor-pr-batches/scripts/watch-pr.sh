#!/usr/bin/env bash
# Emit one line whenever a PR's state, merge status, base, auto-merge or failing-check count changes.
# Exits when the PR is MERGED or CLOSED. Usage: watch-pr.sh <PR>   (run it under the Monitor tool)
pr=$1
previous=""
while true; do
  current=$(gh pr view "$pr" --json state,mergeStateStatus,baseRefName,autoMergeRequest,statusCheckRollup \
    -q '"#'"$pr"' \(.state) \(.mergeStateStatus) base=\(.baseRefName) auto=\(.autoMergeRequest.mergeMethod // "none") failing=\([.statusCheckRollup[] | select((.conclusion // .state) | test("FAILURE|ERROR|CANCELLED|TIMED_OUT")) | .name] | join(","))"' 2>/dev/null) || { sleep 30; continue; }
  if [ "$current" != "$previous" ]; then
    echo "$current"
    previous=$current
  fi
  case "$current" in *" MERGED "*|*" CLOSED "*) exit 0 ;; esac
  sleep 45
done
