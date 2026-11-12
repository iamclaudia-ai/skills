#!/usr/bin/env bash
# For each dangling Postgres volume: version, database names (read from the pg_database
# catalog file, global/1262, without starting a server), and the largest database's size.
# Usage: inspect-orphan-postgres.sh <out-dir>  (reads inventory.tsv, writes postgres.tsv)
set -euo pipefail
out=${1:?usage: $0 <out-dir>}; mkdir -p "$out"; cd "$out"

mapfile -t vols < <(awk -F"\t" "\$4==\"postgres\"{print \$1}" inventory.tsv)
mounts=()
for v in "${vols[@]}"; do mounts+=(-v "$v:/v/$v:ro"); done

docker run --rm --label claudia.scratch=true "${mounts[@]}" alpine:3.20 sh -c '
apk add -q --no-progress binutils >/dev/null 2>&1
for d in /v/*; do
  n=${d#/v/}
  dbs=$(strings -n 3 "$d/global/1262" 2>/dev/null | grep -E "^[a-zA-Z_][a-zA-Z0-9_-]{2,}$" |
        grep -vE "^(C|POSIX|en_US|UTF8|libc|icu)" | sort -u | tr "\n" " ")
  big=$(du -sm "$d"/base/* 2>/dev/null | sort -rn | head -1 | cut -f1)
  printf "%s\tpg%s\tbiggest-db=%sMB\t%s\n" "$n" "$(cat "$d/PG_VERSION")" "${big:-0}" "$dbs"
done' > postgres.tsv

awk -F'\t' '{print $2, $4}' postgres.tsv | sort | uniq -c | sort -rn
