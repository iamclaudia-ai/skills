#!/usr/bin/env bash
# FREE, no key: walk a tweet's reply chain upward through api.fxtwitter.com and print each tweet,
# newest first. Rebuilds an author's self-thread from its LAST tweet. Can't see other people's
# replies or tweets below the one given; use conversation.sh for that.
# Usage: thread-up.sh <tweet-url-or-id> [max=25]
set -euo pipefail
source "$(dirname "$0")/_common.sh"
id=$(tweet_id "$1")
max="${2:-25}"
n=0
while [[ -n "$id" && "$id" != "null" && $n -lt $max ]]; do
  json=$(curl -sS -m 15 "https://api.fxtwitter.com/status/$id")
  jq -r '"=== @\(.tweet.author.screen_name) \(.tweet.created_at) id=\(.tweet.id) likes=\(.tweet.likes) replies=\(.tweet.replies)\n\(.tweet.text)\nMEDIA: \([.tweet.media.all[]? | "\(.type) \(.url)"] | join(", "))\nQUOTE: \(.tweet.quote.author.screen_name // "") \(.tweet.quote.text // "")\n"' <<<"$json"
  id=$(jq -r '.tweet.replying_to_status' <<<"$json")
  n=$((n + 1))
done
