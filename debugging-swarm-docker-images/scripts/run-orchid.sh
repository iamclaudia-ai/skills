#!/usr/bin/env bash
# Run an Orchid production build on a simulated deploy's node_modules, the way the container does,
# against the staging Swarm API. Build first: `doppler run --project <app> --config staging --
# pnpm --filter <app> run build:remix` in the worktree.
# Usage: run-orchid.sh <worktree> <deploy-dir> <orchid-v1|orchid-v2> <port>
# Then: curl -H "X-Forwarded-Host: qa-newsletter.staginghiiv.com" http://127.0.0.1:<port>/
# Stop it by PID: ps -axo pid,command | grep "[n]ode ./build/server/index.js"
set -u
if [ $# -ne 4 ]; then
  echo "usage: run-orchid.sh <worktree> <deploy-dir> <orchid-v1|orchid-v2> <port>" >&2
  exit 1
fi
worktree=$(cd "$1" && pwd); deploy=$(cd "$2" && pwd); app=$3; port=$4

cp -R "$worktree/apps/$app/build" "$worktree/apps/$app/public" "$deploy/"
cd "$deploy"
log="$deploy/server.log"
doppler run --project "$app" --config staging -- env NODE_ENV=production PORT="$port" \
  REDIS_URL=redis://localhost:6379 SWARM_API=https://app.staginghiiv.com/api/v1/orchid \
  node ./build/server/index.js >>"$log" 2>&1 &
echo "started $app on :$port (pid $!), log: $log"
sleep 12
grep -vE '^\{"level":30' "$log" | grep -iE "listening|cannot find|error" | head -n 5
