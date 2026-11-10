#!/usr/bin/env bash
# Run a built Orchid image against the staging Swarm API and probe a test site.
# Env var names come from Doppler and are passed as `-e NAME`, so no secret value touches disk.
# Usage: run-orchid-container.sh <image> <orchid-v1|orchid-v2> <port>
# Clean up afterwards with the deleting-docker-resources skill (delete --mine --stop).
set -u
if [ $# -ne 3 ]; then
  echo "usage: run-orchid-container.sh <image> <orchid-v1|orchid-v2> <port>" >&2
  exit 1
fi
image=$1; app=$2; port=$3
case "$app" in
  orchid-v2) host=qa-newsletter.staginghiiv.com ;;
  orchid-v1) host=pollinate-test.staginghiiv.com ;;
  *) echo "app must be orchid-v1 or orchid-v2" >&2; exit 1 ;;
esac
name="claudia-$app-smoke-$(date +%H%M%S)"

env_flags=$(doppler secrets --project "$app" --config staging --only-names --json |
  python3 -I -c 'import json, sys
skip = {"PORT", "REDIS_URL", "SWARM_API", "NODE_ENV"}
print(" ".join(f"-e {name}" for name in json.load(sys.stdin) if name not in skip))')

# shellcheck disable=SC2086
doppler run --project "$app" --config staging -- docker run -d --label claudia.scratch=true \
  --name "$name" -p "$port:$port" $env_flags \
  -e DOPPLER_CONFIG -e DOPPLER_ENVIRONMENT -e DOPPLER_PROJECT \
  -e PORT="$port" -e NODE_ENV=production -e REDIS_URL=redis://host.docker.internal:6379 \
  -e SWARM_API=https://app.staginghiiv.com/api/v1/orchid "$image" >/dev/null
sleep 15
for path in / /archive; do
  curl -s -m 90 -o /dev/null -w "$path %{http_code} %{content_type}\n" -H "X-Forwarded-Host: $host" "http://127.0.0.1:$port$path"
done
docker logs "$name" 2>&1 | grep -vE '^\{"level":30' | grep -iE "listening|cannot find|error" | grep -v REMIX_DD_ROUTE | head -n 5
docker stop "$name" >/dev/null && echo "stopped $name"
