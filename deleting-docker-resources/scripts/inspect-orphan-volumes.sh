#!/usr/bin/env bash
# Identify what each dangling Docker volume holds, read-only, in one throwaway container.
# Usage: inspect-orphan-volumes.sh <out-dir>  (writes inventory.tsv there)
# Output: name<TAB>size<TAB>created<TAB>kind<TAB>top-level entries
set -euo pipefail
out=${1:?usage: $0 <out-dir>}; mkdir -p "$out"; cd "$out"

docker system df -v --format '{{json .Volumes}}' | jq -r '.[] | [.Name, .Size] | @tsv' > sizes.tsv
mapfile -t vols < <(docker volume ls -qf dangling=true)
[ ${#vols[@]} -gt 0 ] || { echo "No dangling volumes."; exit 0; }

mounts=()
for v in "${vols[@]}"; do mounts+=(-v "$v:/v/$v:ro"); done

# Fingerprints decide the kind; everything else is "unknown" and is never deleted blindly.
docker run --rm --label claudia.scratch=true "${mounts[@]}" alpine:3.20 sh -c '
for d in /v/*; do
  n=${d#/v/}
  if   [ -f "$d/PG_VERSION" ] || [ -f "$d/pgdata/PG_VERSION" ]; then k=postgres
  elif [ -d "$d/metadata" ] && [ -d "$d/store" ] || [ -d "$d/data/system" ]; then k=clickhouse
  elif [ -d "$d/nodes" ] && [ -d "$d/nodes/0" ]; then k=elasticsearch
  elif [ -f "$d/dump.rdb" ] || [ -f "$d/appendonly.aof" ] || [ -d "$d/appendonlydir" ]; then k=redis
  elif [ -z "$(ls -A "$d")" ]; then k=empty
  else k=unknown; fi
  printf "%s\t%s\t%s\n" "$n" "$k" "$(ls -A "$d" | head -8 | tr "\n" " ")"
done' > contents.tsv

while IFS=$'\t' read -r n k top; do
  size=$(awk -F'\t' -v n="$n" '$1==n{print $2}' sizes.tsv)
  created=$(docker volume inspect "$n" --format '{{.CreatedAt}}' | cut -c1-10)
  printf '%s\t%s\t%s\t%s\t%s\n' "$n" "$size" "$created" "$k" "$top"
done < contents.tsv | sort -t$'\t' -k4,4 -k3,3 > inventory.tsv

echo "By kind:"; cut -f4 inventory.tsv | sort | uniq -c | sort -rn
echo; echo "Inventory written to $(pwd)/inventory.tsv"
