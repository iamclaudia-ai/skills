#!/bin/zsh
# Weekly X bookmarks digest (Anima scheduler, exec, vesuvius: the xurl login and the archive live there).
#
# Syncs new bookmarks (~$0.05 when nothing is new, plus $0.005 per new one) and saves their media, then, if
# anything arrived since the last digest (digests/LAST), starts a session that follows
# references/weekly-digest.md. Quiet weeks just log a line.
#
#   bookmarks-weekly.sh            sync, and start the digest session if there's anything new
#   bookmarks-weekly.sh --dry-run  report what's new without syncing or starting anything
set -u

SKILL=${0:A:h:h}
S=$SKILL/scripts
ARCHIVE=${X_BOOKMARKS_DIR:-$HOME/.anima/x-bookmarks}
LOG=$ARCHIVE/weekly.log
REPO=$HOME/Projects/iamclaudia-ai/anima
export PATH=/opt/homebrew/bin:$HOME/.bun/bin:$HOME/.local/bin:/usr/bin:/bin

log() { echo "$(date '+%F %T') $1" | tee -a "$LOG"; }

if [[ "${1:-}" != "--dry-run" ]]; then
  bun "$S/bookmarks-sync.ts" >> "$LOG" 2>&1 || { log "sync failed (see above)"; exit 1; }
fi

last=$(head -1 "$ARCHIVE/digests/LAST" 2>/dev/null)
[[ -n "$last" ]] || { log "no digests/LAST marker"; exit 1; }
count=$(bun "$S/bookmarks-show.ts" --until "$last" --count 2>>"$LOG") || { log "count failed"; exit 1; }

if (( count == 0 )); then
  log "nothing new since $last"
  exit 0
fi
if [[ "${1:-}" == "--dry-run" ]]; then
  log "dry run: $count new since $last, would start the digest session"
  exit 0
fi

session="X bookmarks digest $(date +%F)"
log "starting \"$session\" for $count new bookmark(s)"
# --profile yolo: unattended. The runbook reads, writes the digest, files issues and texts Michael; it never
# acts on X as him.
nohup anima session spawn_agent \
  --parentSessionId NEW \
  --profile yolo \
  --name "$session" \
  --cwd "$REPO" \
  --prompt "🔖 Weekly X bookmarks digest: $count new bookmark(s) since the last one. This is a fresh session; read $SKILL/references/weekly-digest.md and follow it. The sync and media download already ran. 💙" \
  >> "$LOG" 2>&1 &
echo "started digest session: $count new"
