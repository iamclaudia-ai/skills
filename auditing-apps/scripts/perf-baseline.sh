#!/usr/bin/env bash
# perf-baseline.sh [label]
#
# Snapshot how loaded the Mac is: uptime and load, memory and swap, top CPU and
# RAM processes, background work that skews the numbers (Time Machine, iCloud,
# Spotlight), launchd job counts, and the diagnostic reports of the last 24h
# (hangs, cpu_resource, jetsam: the trail a freeze leaves). Writes
# ~/dotfiles/tmp/perf-baselines/<timestamp>[-label].txt and prints it.
#
# Compare two with: diff <(grep -v '^ ' a.txt) <(grep -v '^ ' b.txt), or just read them side by side.
set -uo pipefail

OUT_DIR="$HOME/dotfiles/tmp/perf-baselines"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$OUT_DIR/$STAMP${1:+-$1}.txt"

{
	echo "# perf baseline $STAMP ${1:-}"
	echo "## uptime"
	uptime
	echo "boot: $(sysctl -n kern.boottime | sed -E 's/.*} //')"
	echo
	echo "## memory"
	memory_pressure 2>/dev/null | grep -E "free percentage"
	echo "swap: $(sysctl -n vm.swapusage)"
	echo
	echo "## background work that skews the numbers"
	tmutil status 2>/dev/null | grep -E "Running|Percent|BackupPhase" | tr -s ' '
	echo "local snapshots: $(tmutil listlocalsnapshots / 2>/dev/null | grep -c TimeMachine)"
	for p in backupd cloudd bird mds mds_stores mdworker_shared fileproviderd photoanalysisd mediaanalysisd; do
		ps -axo pcpu=,comm= | awk -v p="$p" '{n=split($2,a,"/"); if (a[n]==p) s+=$1} END {if (s>0) printf "  %-18s %6.1f%%\n", p, s}'
	done
	echo
	echo "## top CPU"
	ps -axo pcpu=,rss=,comm= -r | head -15 | awk '{rss=$2/1024; cmd=$0; sub(/^ *[^ ]+ +[^ ]+ +/, "", cmd); n=split(cmd,a,"/"); printf "  %5.1f%% %7.0fMB  %s\n", $1, rss, a[n]}'
	echo
	echo "## top RAM"
	ps -axo rss=,pcpu=,comm= -m | head -15 | awk '{rss=$1/1024; cmd=$0; sub(/^ *[^ ]+ +[^ ]+ +/, "", cmd); n=split(cmd,a,"/"); printf "  %7.0fMB %5.1f%%  %s\n", rss, $2, a[n]}'
	echo
	echo "## counts"
	echo "processes: $(ps -ax | wc -l | tr -d ' ')"
	echo "launchd gui jobs loaded: $(launchctl list | tail -n +2 | wc -l | tr -d ' ')"
	echo "launchd gui jobs running: $(launchctl list | tail -n +2 | awk '$1 != "-"' | wc -l | tr -d ' ')"
	echo
	echo "## diagnostic reports, last 24h (hang = UI froze; cpu_resource = sustained CPU; Jetsam = memory kill)"
	find /Library/Logs/DiagnosticReports "$HOME/Library/Logs/DiagnosticReports" -maxdepth 1 -type f -mtime -1 \
		! -name '*.core_analytics' 2>/dev/null |
		sed -E 's#.*/##; s/_[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}(_[^.]*)?//; s/-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}//' |
		sort | uniq -c | sort -rn | sed 's/^/  /'
} | tee "$OUT"
echo
echo "saved: $OUT"
