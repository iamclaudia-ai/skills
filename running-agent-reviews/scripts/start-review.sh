#!/bin/bash
# Starts a fresh Claudia session that reviews a PR from a written brief, without blocking.
#
# usage: start-review.sh <brief.md> "<session title>" [repo root]
#
# `anima session send_prompt` blocks until the reviewer's whole turn ends (up to an hour,
# with a device pass), so it runs in the background. <brief>.log gets only errors: the
# reviewer's final message comes from review-status.sh (session history).
set -euo pipefail
BRIEF=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
TITLE=$2
ROOT=${3:-$(git -C "$(dirname "$BRIEF")" rev-parse --show-toplevel)}
LOG="${BRIEF%.md}.log"

[ -s "$BRIEF" ] || { echo "no brief at $BRIEF" >&2; exit 1; }

SID=$(anima session create_session --cwd "$ROOT" --title "$TITLE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sessionId"])')
echo "session $SID ($TITLE)"
echo "# $(date '+%F %T') session $SID" >> "$LOG"
nohup anima session send_prompt --sessionId "$SID" --cwd "$ROOT" --content "$(cat "$BRIEF")" >> "$LOG" 2>&1 &
sleep 10
if anima session get_info --sessionId "$SID" | grep -q '"turnActive": true'; then
  echo "running; check with: review-status.sh $SID <PR>"
else
  echo "WARNING: turn not active after 10 s; check $LOG and: anima session get_info --sessionId $SID" >&2
fi
