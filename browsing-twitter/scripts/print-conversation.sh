#!/usr/bin/env bash
# Print a conversation.sh file. Default order: most-liked first. --time for chronological.
# Usage: print-conversation.sh <conversation.json> [--time]
set -euo pipefail
sort='sort_by(-.public_metrics.like_count)'
[[ "${2:-}" == "--time" ]] && sort='sort_by(.created_at)'
jq -r "(.users | map({(.id): .username}) | add) as \$u | .posts | $sort | .[] |
  \"[\(.public_metrics.like_count)♥ \(.created_at[5:16])] @\(\$u[.author_id]): \(.text | gsub(\"\n\"; \" \"))\"" "$1"
