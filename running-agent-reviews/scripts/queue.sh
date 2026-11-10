#!/bin/bash
# Runs a lane of kiliman review sessions one after another: each starts when the one before it
# (or the session given with --after) has ended its turn. Every start and finish goes to
# tmp/review-agent/queue.log, which my session watches with Monitor.
#
# usage (from the repo root, in tmux): queue.sh <lane name> [--after <session id>] <PR> [<PR> ...]
#   brief for each PR: tmp/review-agent/<PR>/PROMPT.md
#   e.g. queue.sh devices --after 0b8a774b-... 415 403 405
#        queue.sh light 380 393
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel)   # run it from the repo root
LOG=$ROOT/tmp/review-agent/queue.log
S=$(cd "$(dirname "$0")" && pwd)
LANE=$1; shift
AFTER=""
if [ "${1:-}" = "--after" ]; then AFTER=$2; shift 2; fi

say() { echo "$(date '+%F %T') [$LANE] $*" >> "$LOG"; }

active() {
  # get_info also lists every other active session, each with its own turnActive: read ours only.
  # A failed call counts as active, so a hiccup never starts the next reviewer early.
  anima session get_info --sessionId "$1" 2>/dev/null |
    python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["session"].get("turnActive") is False else 1)' && return 1
  return 0
}

wait_for() {
  local sid=$1 pr=$2
  while active "$sid"; do sleep 60; done
  local last
  last=$(GH_AS=kiliman gh pr view "$pr" --repo 3votech/evolution-mobile --json reviews \
    --jq '[.reviews[]|select(.author.login=="kiliman")][-1]|(.author.login+" "+.state+" "+.submittedAt)' 2>/dev/null)
  say "DONE #$pr session $sid -> last kiliman review: ${last:-none}"
}

[ -n "$AFTER" ] && { say "waiting for $AFTER before #$1"; wait_for "$AFTER" "${AFTER_PR:-0}"; }

for pr in "$@"; do
  brief=$ROOT/tmp/review-agent/$pr/PROMPT.md
  title=$(sed -n 's/^You are reviewing \*\*PR #[0-9]*\*\* ("\(.*\)").*/\1/p' "$brief" | head -1)
  [ -z "$title" ] && title="the #$pr stack"
  out=$("$S/start-review.sh" "$brief" "Review #$pr as kiliman ($title)" "$ROOT" 2>&1)
  sid=$(echo "$out" | sed -n 's/^session \([0-9a-f-]*\) .*/\1/p')
  if [ -z "$sid" ]; then say "ERROR starting #$pr: $out"; exit 1; fi
  say "STARTED #$pr session $sid"
  echo "$out" | grep -q WARNING && say "WARNING #$pr: turn not active after 10 s"
  sleep 30
  wait_for "$sid" "$pr"
done
say "LANE FINISHED"
