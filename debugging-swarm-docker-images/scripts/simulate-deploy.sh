#!/usr/bin/env bash
# Simulate an image's `pnpm deploy` without Docker: build pnpm-workspace.yaml the way the Dockerfile
# does, deploy the app into <out-dir>, restore the workspace file, and list React Router copies.
# Usage: simulate-deploy.sh <worktree> <out-dir> <app> <package dir>...
# Works before swarm#34290 (docker/pnpm-workspace.deploy.yaml) and after (write-deploy-workspace.mjs).
set -u
if [ $# -lt 4 ]; then
  echo "usage: simulate-deploy.sh <worktree> <out-dir> <app> <package dir>..." >&2
  exit 1
fi
worktree=$(cd "$1" && pwd); out=$2; app=$3; shift 3
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
if [ -e "$out" ]; then
  echo "refusing: $out already exists (pnpm deploy needs an empty target)" >&2
  exit 1
fi

cd "$worktree"
backup=$(mktemp)
cp pnpm-workspace.yaml "$backup"
restore() { cp "$backup" pnpm-workspace.yaml; }
trap restore EXIT

if [ -f docker/write-deploy-workspace.mjs ]; then
  node docker/write-deploy-workspace.mjs "$@"
else
  python3 -I -c '
import sys
body = "packages:\n" + "".join(f"  - {p!r}\n" for p in sys.argv[1:])
body += open("docker/pnpm-workspace.deploy.yaml").read()
open("pnpm-workspace.yaml", "w").write(body)
' "$@"
fi

log="$out.log"
pnpm --filter "$app" deploy --prod "$out" >>"$log" 2>&1
status=$?
restore
trap - EXIT
echo "== $app deploy exit $status (log: $log)"
[ $status -eq 0 ] || exit $status
ls "$out/node_modules/.pnpm" | grep -E '^(react-router|react-router-dom|@remix-run\+router|react|react-dom)@' | sed 's/_.*//' | sort -u
git -C "$worktree" status --short -- pnpm-workspace.yaml
