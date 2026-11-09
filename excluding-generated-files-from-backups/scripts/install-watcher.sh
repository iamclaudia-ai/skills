#!/bin/bash
# Install (or reinstall) the launchd agent that runs watch-generated-folders.sh at login and
# restarts it if it exits. Needs fswatch (brew install fswatch). Usage: install-watcher.sh [--remove]
set -euo pipefail

LABEL=ai.iamclaudia.exclude-generated-watcher
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/exclude-generated-watcher.log"
SCRIPT="$HOME/.claude/skills/excluding-generated-files-from-backups/scripts/watch-generated-folders.sh"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

command -v fswatch >/dev/null || [ -x /opt/homebrew/bin/fswatch ] || {
  echo "fswatch not found: brew install fswatch" >&2
  exit 1
}

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 2
launchctl print "$DOMAIN/$LABEL" | grep -E '^\s*(state|pid) ='
tail -1 "$LOG"
