#!/usr/bin/env bash
# beehiiv swarm: regenerate and verify one group branch after merge-heads.py.
# Usage: verify-group-swarm.sh <work> <label> [PR ...]     run from the swarm worktree root
# Regenerates pnpm-lock.yaml (commits it if changed), runs verify-lock.py, a frozen install, both Orchid builds
# and the orchid-v2 bundle budget check. Logs land in <work>/group-<label>-*.log.
# pnpm needs `doppler run --`: @beehiiv/ui is private on npmjs (PNPM_CONFIG_NPMRC_AUTH_FILE).
set -u
work=$1; label=$2; shift 2
scripts=$(cd "$(dirname "$0")" && pwd)
log=$work/group-$label
export HUSKY=0

doppler run -- pnpm install --no-frozen-lockfile > "$log-regen.log" 2>&1 || { echo "regen FAILED ($log-regen.log)"; exit 1; }
if ! git diff --quiet -- pnpm-lock.yaml; then
  git add pnpm-lock.yaml && git commit -q --no-verify -m "chore(deps): regenerate pnpm-lock.yaml for the $label group"
  echo "lockfile regenerated + committed"
fi
python3 "$scripts/verify-lock.py" "$work" "$@" | grep -v " ok:"
doppler run -- pnpm install --frozen-lockfile > "$log-frozen.log" 2>&1 && echo "frozen install OK" || echo "frozen install FAILED"
pnpm --filter orchid-v1 build > "$log-orchid-v1.log" 2>&1 && echo "orchid-v1 build OK" || echo "orchid-v1 build FAILED"
pnpm --filter orchid-v2 build:remix > "$log-orchid-v2.log" 2>&1 && echo "orchid-v2 build OK" || echo "orchid-v2 build FAILED"
(cd apps/orchid-v2 && node scripts/bundle-report.mjs --check) > "$log-budget.log" 2>&1 && echo "budget OK" || echo "budget FAILED"
grep -E "^total client JS" "$log-budget.log"
grep -E '"totalClientJsGzipKb"' apps/orchid-v2/bundle-budget.json
