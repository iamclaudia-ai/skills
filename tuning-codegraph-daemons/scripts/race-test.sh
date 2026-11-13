#!/usr/bin/env bash
# Race: a daemon (spawned by an MCP query) starting while the CLI `codegraph sync` runs, plus a file
# edit mid-sync to exercise the watcher's lock retries. Usage: race-test.sh <worktree> <query> <file-to-touch>
set -uo pipefail
WT=$1 QUERY=$2 TOUCH=$3
S=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
LOG="${RACE_LOG:-$PWD/race-sync.log}"
: >"$LOG"
( cd "$WT" && codegraph sync 2>&1 | python3 -I "$S/scripts/ts.py" >>"$LOG" ) &
sync_pid=$!
sleep 3
echo "--- query at 3s"
python3 -I "$S/scripts/mcp-query.py" "$WT" "$QUERY" 2>&1
echo "--- writer.pid / codegraph.lock"
cat "$WT/.codegraph/writer.pid" "$WT/.codegraph/codegraph.lock" 2>&1; echo
echo "--- touch $TOUCH mid-sync at $(date +%T)"
echo "# probe" >>"$WT/$TOUCH"
wait "$sync_pid"
echo "--- sync done at $(date +%T)"
cat "$LOG"
sleep 5
echo "--- query after sync"
python3 -I "$S/scripts/mcp-query.py" "$WT" "$QUERY" 2>&1
echo "--- daemon.log"
cat "$WT/.codegraph/daemon.log"
