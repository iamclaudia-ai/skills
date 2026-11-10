#!/usr/bin/env bash
# Build a swarm Node image with docker, labelled for the deleting-docker-resources skill, and list
# key packages in its runtime node_modules. Sentry source-map uploads are stripped through a
# temporary Dockerfile variant, so a local test build never uploads to Sentry.
# Run under Doppler for the Tiptap token:
#   doppler run --project swarm --config dev -- build-image.sh <worktree> <app> <tag>
# Image: claudia-deploy-<app>:<tag>. Logs go to the main checkout's tmp/image-logs, which survives reboots.
set -u
if [ $# -ne 3 ]; then
  echo "usage: build-image.sh <worktree> <app> <tag>" >&2
  exit 1
fi
worktree=$(cd "$1" && pwd); app=$2; tag=$3
: "${NPM_TIPTAP_REGISTRY_TOKEN:?run under: doppler run --project swarm --config dev --}"
logs="$HOME/Projects/beehiiv/swarm/tmp/image-logs"
mkdir -p "$logs"
image="claudia-deploy-$app:$tag"
log="$logs/$app-$tag-$(date +%H%M%S).log"
variant=$(mktemp "${TMPDIR:-/tmp}/dockerfile-$app-XXXXXX")

python3 -I -c '
import sys
app, source, target = sys.argv[1:]
text = open(source).read()
swaps = {
    f"    pnpm --filter {app} build && \\\n": f"    pnpm --filter {app} run build:remix && \\\n",
    "    pnpm build\n": "    pnpm exec tsup\n",
}
for old, new in swaps.items():
    if old in text:
        text = text.replace(old, new)
        print(f"variant: {old.strip()} -> {new.strip()}")
open(target, "w").write(text)
' "$app" "$worktree/apps/$app/Dockerfile" "$variant"

cd "$worktree"
docker build --label claudia.scratch=true \
  --secret id=npm_tiptap_registry_token,env=NPM_TIPTAP_REGISTRY_TOKEN \
  -f "$variant" -t "$image" . >>"$log" 2>&1
status=$?
echo "== $app build exit $status (log: $log)"
if [ $status -ne 0 ]; then
  grep -E "ERROR|ERR_PNPM" "$log" | grep -v EXDEV | tail -n 8
  exit $status
fi
docker run --rm --label claudia.scratch=true --entrypoint sh "$image" -c 'ls node_modules/.pnpm' |
  grep -E '^(react-router|react-router-dom|@remix-run\+router|react|qs|lodash|tar|vite|postcss|glob|@opentelemetry\+instrumentation-pg)@' |
  sed 's/_.*//' | sort -u | tr '\n' ' '
echo
