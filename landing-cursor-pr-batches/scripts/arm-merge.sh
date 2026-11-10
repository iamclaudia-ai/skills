#!/usr/bin/env bash
# Arm auto-merge on a group PR with a MERGE COMMIT, after the guards that keep it from landing wrong.
# Usage: arm-merge.sh <PR> [base]      base defaults to main
# Refuses when: the PR's base isn't <base> (a stacked child would merge INTO its parent branch), it isn't
# APPROVED, or it has unresolved review threads. Replaces any existing auto-merge whose method isn't MERGE:
# `gh pr merge --merge --auto` leaves an existing SQUASH request in place, so this goes through GraphQL.
set -euo pipefail
pr=$1; want_base=${2:-main}
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
info=$(gh pr view "$pr" --json id,baseRefName,reviewDecision,autoMergeRequest,state)
base=$(jq -r .baseRefName <<<"$info"); review=$(jq -r .reviewDecision <<<"$info"); id=$(jq -r .id <<<"$info")
current=$(jq -r '.autoMergeRequest.mergeMethod // "none"' <<<"$info")
[ "$(jq -r .state <<<"$info")" = OPEN ] || { echo "#$pr is not open"; exit 1; }
[ "$base" = "$want_base" ] || { echo "#$pr base is $base, not $want_base: merge the PR below it first (or retarget). Not arming."; exit 1; }
[ "$review" = APPROVED ] || { echo "#$pr review is $review: not arming without an approval."; exit 1; }
unresolved=$(gh api graphql -f query="query{repository(owner:\"${repo%/*}\",name:\"${repo#*/}\"){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved}}}}}" \
  -q '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length')
[ "$unresolved" = 0 ] || { echo "#$pr has $unresolved unresolved review thread(s): not arming."; exit 1; }
if [ "$current" != none ] && [ "$current" != MERGE ]; then
  gh pr merge "$pr" --disable-auto >/dev/null
  echo "#$pr: removed an existing $current auto-merge"
fi
method=$(gh api graphql -f query="mutation{enablePullRequestAutoMerge(input:{pullRequestId:\"$id\",mergeMethod:MERGE}){pullRequest{autoMergeRequest{mergeMethod}}}}" \
  -q '.data.enablePullRequestAutoMerge.pullRequest.autoMergeRequest.mergeMethod')
echo "#$pr auto-merge armed: $method (base $base, $review)"
[ "$method" = MERGE ]
