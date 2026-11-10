#!/usr/bin/env bash
# Compare PRs that fix the same package, to pick the keeper.
# Usage: compare-prs.sh <ecosystem> <package> <PR> [PR ...]     ecosystem: npm | rubygems | pip | ...
# Prints the package's open Dependabot alerts (with first patched versions), what main resolves, and per PR:
# draft/mergeable/review state, check summary + failures, files, resolved versions, and the non-lockfile diff.
# Run from the repo root.
set -euo pipefail
ecosystem="$1"; package="$2"; shift 2
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
escaped=$(printf '%s' "$package" | sed 's/[.[\*^$/]/\\&/g')
case "$ecosystem" in
  npm) lockfile=pnpm-lock.yaml; pattern="^  '?$escaped@[0-9][^:(']*" ;;
  rubygems) lockfile=Gemfile.lock; pattern="^    $escaped \([^)]*\)" ;;
  *) lockfile=""; pattern="" ;;
esac
resolves() { [ -n "$lockfile" ] && git show "$1:$lockfile" 2>/dev/null | grep -oE "$pattern" | sed "s/^ *'\{0,1\}//" | sort -u | tr '\n' ' '; }

echo "################ $package ($ecosystem)"
echo "-- open alerts"
gh api "/repos/$repo/dependabot/alerts?state=open&ecosystem=$ecosystem&package=$package&per_page=100" \
  --jq '.[] | "  #\(.number) \(.security_advisory.ghsa_id) \(.security_advisory.severity) \(.dependency.manifest_path) vuln=\(.security_vulnerability.vulnerable_version_range) fix=\(.security_vulnerability.first_patched_version.identifier // "NONE")"'
git fetch -q origin main
echo "-- main resolves: $(resolves origin/main)"

for pr in "$@"; do
  info=$(gh pr view "$pr" --json headRefName,headRefOid,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,createdAt)
  head=$(jq -r .headRefOid <<<"$info")
  git fetch -q origin "+refs/pull/$pr/head:refs/remotes/origin/pr/$pr"
  base=$(git merge-base origin/main "$head")
  echo
  echo "=== #$pr $(jq -r .headRefName <<<"$info") created=$(jq -r '.createdAt[0:10]' <<<"$info") draft=$(jq -r .isDraft <<<"$info") $(jq -r '"\(.mergeable)/\(.mergeStateStatus) review=\(.reviewDecision)"' <<<"$info") head=${head:0:10}"
  echo "  checks: $(jq -r '[.statusCheckRollup[] | (.conclusion // .state // .status)] | group_by(.) | map("\(.[0])=\(length)") | join(" ")' <<<"$info")"
  jq -r '.statusCheckRollup[] | select((.conclusion // .state) == "FAILURE") | "  FAILED: \(.name) \(.detailsUrl)"' <<<"$info"
  echo "  files: $(git diff --name-only "$base" "$head" | tr '\n' ' ')"
  echo "  resolves: $(resolves "$head")"
  echo "  commits behind main: $(git rev-list --count "$base"..origin/main)"
  echo "  -- non-lockfile diff vs merge-base:"
  git diff "$base" "$head" -- . ':(exclude)pnpm-lock.yaml' ':(exclude)Gemfile.lock' | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | cut -c1-220 | sed 's/^/    /'
done
