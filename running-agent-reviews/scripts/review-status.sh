#!/bin/bash
# Is a reviewer session still working? Prints its state and, once it's done, the review
# GitHub recorded (author, state, first line), so a wrong account or a missing 🤖 line shows.
#
# usage: review-status.sh <session id> [PR number] [owner/repo]
set -uo pipefail
SID=$1; PR=${2:-}; REPO=${3:-3votech/evolution-mobile}
anima session get_info --sessionId "$SID" | python3 -c '
import json, sys
s = json.load(sys.stdin)["session"]
print("turnActive=%s lastActivity=%s healthy=%s" % (s.get("turnActive"), s.get("lastActivity"), s.get("healthy")))'
if [ -n "$PR" ]; then
  GH_AS=kiliman gh api "repos/$REPO/pulls/$PR/reviews" --jq \
    '.[-1] | "last review: \(.user.login) \(.state) \(.submitted_at)\n\(.body | split("\n")[0])"'
fi
