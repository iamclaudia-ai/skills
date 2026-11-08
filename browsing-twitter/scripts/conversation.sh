#!/usr/bin/env bash
# PAID ($0.005 per post): every post in a tweet's conversation (the author's thread plus all
# replies) via the official X API recent search. Only conversations active in the last 7 days.
# Pass any tweet in the thread; its conversation_id is looked up first.
# Usage: conversation.sh <tweet-url-or-id> <out.json> [max-pages=10]   (100 posts per page)
set -euo pipefail
source "$(dirname "$0")/_common.sh"
load_x_token
id=$(tweet_id "$1")
out="$2"
max_pages="${3:-10}"
conv=$(x_get "tweets/${id}?tweet.fields=conversation_id" | jq -r '.data.conversation_id // empty')
[[ -n "$conv" ]] || { echo "Could not look up tweet $id" >&2; exit 1; }
fields="tweet.fields=author_id,created_at,in_reply_to_user_id,referenced_tweets,public_metrics,conversation_id&expansions=author_id,attachments.media_keys&user.fields=username,name&media.fields=type,url,preview_image_url"
token=""
pages=()
for _ in $(seq 1 "$max_pages"); do
  path="tweets/search/recent?query=conversation_id:${conv}&max_results=100&${fields}"
  [[ -n "$token" ]] && path="${path}&next_token=${token}"
  page=$(x_get "$path")
  pages+=("$page")
  token=$(jq -r '.meta.next_token // empty' <<<"$page")
  [[ -z "$token" ]] && break
done
# The search never returns the root tweet itself; fetch it so the file is complete.
root=$(x_get "tweets/${conv}?${fields}")
printf '%s\n' "$root" "${pages[@]}" | jq -s --arg conv "$conv" '{
  conversation_id: $conv,
  posts: ([.[] | .data // [] | if type == "array" then .[] else . end] | unique_by(.id)),
  users: ([.[].includes.users // [] | .[]] | unique_by(.id)),
  media: ([.[].includes.media // [] | .[]] | unique_by(.media_key)),
  errors: [.[].errors // [] | .[]]
}' >"$out"
jq -r '"\(.posts | length) posts from \(.users | length) people (~$\(.posts | length * 0.005 * 100 | round / 100)). Errors: \(.errors | length)"' "$out"
