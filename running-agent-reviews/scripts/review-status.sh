#!/bin/bash
# Is a reviewer session still working? Prints its state; once its turn has ended, its final
# message (the report the brief asks for), and with a PR number the review GitHub recorded
# (author, state, first line), so a wrong account or a missing 🤖 line shows.
#
# usage: review-status.sh <session id> [PR number] [owner/repo]
set -uo pipefail
SID=$1; PR=${2:-}; REPO=${3:-3votech/evolution-mobile}
ACTIVE=$(anima session get_info --sessionId "$SID" | python3 -c '
import json, sys
s = json.load(sys.stdin)["session"]
print("turnActive=%s lastActivity=%s healthy=%s" % (s.get("turnActive"), s.get("lastActivity"), s.get("healthy")))')
echo "$ACTIVE"
if [[ $ACTIVE == turnActive=False* ]]; then
  echo "--- final message ---"
  anima session get_history --sessionId "$SID" --limit 4 | python3 -c '
import json, sys
texts = [b["content"] for m in json.load(sys.stdin)["messages"] if m.get("role") == "assistant"
         for b in m.get("blocks", []) if b.get("type") == "text"]
print(texts[-1] if texts else "(no text message)")'
fi
if [ -n "$PR" ]; then
  GH_AS=kiliman gh api "repos/$REPO/pulls/$PR/reviews" --jq \
    '.[-1] | "last review: \(.user.login) \(.state) \(.submitted_at)\n\(.body | split("\n")[0])"'
fi
