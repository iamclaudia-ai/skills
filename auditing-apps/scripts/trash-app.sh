#!/usr/bin/env bash
# trash-app.sh "App Name|bundle.id" [...] [--dry-run]
#
# Remove hand-installed apps (no Homebrew or App Store receipt) and their usual
# per-user data. Everything goes to the Trash, so it's recoverable until the
# Trash is emptied. Quits the app first, boots out launchd jobs named after the
# bundle id, and prints the matching Homebrew cask's zap stanza (when there is
# one) so the app-specific extras can be trashed by hand afterwards.
#
# Find the bundle id with: mdls -name kMDItemCFBundleIdentifier -raw "/Applications/X.app"
set -uo pipefail

DRY=0
ARGS=()
for a in "$@"; do
	if [ "$a" = "--dry-run" ]; then DRY=1; else ARGS+=("$a"); fi
done
if [ ${#ARGS[@]} -eq 0 ]; then
	echo "usage: trash-app.sh \"App Name|bundle.id\" [...] [--dry-run]" >&2
	exit 2
fi

UID_N="$(id -u)"
L="$HOME/Library"

t() {
	for p in "$@"; do
		[ -e "$p" ] || [ -L "$p" ] || continue
		if [ $DRY -eq 1 ]; then echo "  would trash $p"; continue; fi
		echo "  trash $p"
		trash "$p" 2>/dev/null || sudo trash "$p" || echo "  !! failed $p"
	done
}

bootout() {
	for l in "$@"; do
		[ $DRY -eq 1 ] && { echo "  would bootout $l"; continue; }
		launchctl bootout "gui/$UID_N/$l" 2>/dev/null && echo "  bootout gui/$l"
		sudo -n launchctl bootout "system/$l" 2>/dev/null && echo "  bootout system/$l"
	done
}

for e in "${ARGS[@]}"; do
	name="${e%%|*}" bid="${e#*|}"
	if [ "$name" = "$e" ] || [ -z "$bid" ]; then
		echo "!! '$e' is not \"App Name|bundle.id\"" >&2
		continue
	fi
	echo "== $name ($bid)"
	if [ $DRY -eq 0 ]; then
		osascript -e "tell application id \"$bid\" to quit" >/dev/null 2>&1 || true
		pkill -x "$name" 2>/dev/null || true
	fi

	# launchd jobs named after the bundle id (helpers, updaters, login launchers)
	jobs=$(launchctl list | awk '{print $3}' | grep -F "$bid" || true)
	[ -n "$jobs" ] && bootout $jobs

	t "/Applications/$name.app" "/Applications/Setapp/$name.app"
	shopt -s nullglob
	t "$L/Application Support/$bid" "$L/Application Support/$name" "$L/Caches/$bid" "$L/Caches/$bid.ShipIt" \
		"$L/HTTPStorages/$bid" "$L/HTTPStorages/$bid.binarycookies" "$L/Cookies/$bid.binarycookies" \
		"$L/WebKit/$bid" "$L/Saved Application State/$bid.savedState" "$L/Logs/$bid" "$L/Logs/$name" \
		"$L"/Preferences/"$bid"*.plist "$L"/Containers/"$bid"* "$L"/Application\ Scripts/*"$bid"* \
		"$L"/Group\ Containers/*"$bid"* "$L"/LaunchAgents/"$bid"*.plist
	shopt -u nullglob

	# The cask's zap stanza lists the extras (daemons, drivers, shared dirs) this generic pass misses.
	token=$(brew search --cask "/^$(echo "$name" | tr '[:upper:] ' '[:lower:]-')\$/" 2>/dev/null | head -1)
	if [ -n "$token" ]; then
		echo "  cask '$token' uninstall/zap paths (check, then trash by hand):"
		brew info --json=v2 --cask "$token" 2>/dev/null |
			python3 -c 'import json,sys
c=json.load(sys.stdin)["casks"][0]
for a in c.get("artifacts",[]):
    for k in ("uninstall","zap"):
        if k in a:
            for d in a[k]:
                if isinstance(d,dict):
                    for kk,v in d.items(): print(f"    {k}.{kk}: {v}")'
	fi
done
echo "done. Next: sudo sfltool dumpbtm, then btm-audit, to catch login items left pointing into the Trash."
