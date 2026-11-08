# Shared helpers for the browsing-twitter scripts. Source, don't run.

# Tweet id from a URL (x.com / twitter.com / fxtwitter …/status/<id>) or a bare id.
tweet_id() {
  local arg="$1"
  if [[ "$arg" =~ /status(es)?/([0-9]+) ]]; then
    echo "${BASH_REMATCH[2]}"
  elif [[ "$arg" =~ ^[0-9]+$ ]]; then
    echo "$arg"
  else
    echo "Not a tweet URL or id: $arg" >&2
    return 1
  fi
}

# Load X_BEARER_TOKEN (Michael's Kiliman app, app-only auth) from the rendered secrets file.
load_x_token() {
  if [[ -z "${X_BEARER_TOKEN:-}" && -f "$HOME/dotfiles/secrets/apikeys.sh" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/dotfiles/secrets/apikeys.sh"
  fi
  if [[ -z "${X_BEARER_TOKEN:-}" ]]; then
    echo "X_BEARER_TOKEN is not set (expected in ~/dotfiles/secrets/apikeys.sh)." >&2
    return 1
  fi
}

# GET an X API v2 path, e.g. x_get "tweets/123?tweet.fields=conversation_id".
x_get() {
  curl -sS -m 30 -H "Authorization: Bearer $X_BEARER_TOKEN" "https://api.x.com/2/$1"
}
