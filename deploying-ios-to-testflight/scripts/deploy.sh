#!/usr/bin/env bash
# Archive one or more iOS schemes and upload each to App Store Connect (TestFlight).
#
# Usage: deploy.sh <abs-path-to.xcworkspace|.xcodeproj> <scheme> [<scheme>...]
#
# Archives land in ~/Library/Developer/Xcode/Archives/<date>/ so they show up in
# Xcode's Organizer, exactly like a manual Product > Archive.
set -euo pipefail

# Apple's /usr/bin/rsync (openrsync) spawns its "server" half by looking up
# `rsync` on PATH. If Homebrew's rsync 3.x wins, the protocols don't match and
# exportArchive dies with the useless "Copy failed" error. Pin PATH to system dirs.
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

if [[ $# -lt 2 ]]; then
  echo "usage: deploy.sh <abs-path-to.xcworkspace|.xcodeproj> <scheme> [<scheme>...]" >&2
  exit 2
fi

container="$1"; shift
case "$container" in
  *.xcworkspace) container_flag=-workspace ;;
  *.xcodeproj)   container_flag=-project ;;
  *) echo "error: first argument must be a .xcworkspace or .xcodeproj" >&2; exit 2 ;;
esac
[[ -e "$container" ]] || { echo "error: $container not found" >&2; exit 2; }

archive_dir="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)"
work_dir="$(mktemp -d -t testflight-deploy)"
mkdir -p "$archive_dir"
echo "Logs: $work_dir"

progress() {
  echo "$1"
  if [[ -n "${ANIMA_TASK_ID:-}" ]] && command -v anima >/dev/null 2>&1; then
    anima scheduler update_progress --taskId "$ANIMA_TASK_ID" --message "$1" >/dev/null 2>&1 || true
  fi
}

failed=()
for scheme in "$@"; do
  stamp="$(date '+%-m-%-d-%y, %-I.%M %p')"
  archive="$archive_dir/$scheme $stamp.xcarchive"
  log_archive="$work_dir/$scheme-archive.log"
  log_upload="$work_dir/$scheme-upload.log"

  progress "[$scheme] archiving..."
  if ! xcodebuild "$container_flag" "$container" -scheme "$scheme" -configuration Release \
      -destination 'generic/platform=iOS' -archivePath "$archive" \
      -allowProvisioningUpdates archive >"$log_archive" 2>&1; then
    grep -E "error:" "$log_archive" | head -20 || true
    progress "[$scheme] ARCHIVE FAILED (see $log_archive)"
    failed+=("$scheme"); continue
  fi

  props="$archive/Info.plist"
  team="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:Team' "$props")"
  bundle="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleIdentifier' "$props")"
  version="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$props")"
  build="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$props")"
  progress "[$scheme] archived $bundle $version ($build), uploading..."

  export_opts="$work_dir/$scheme-ExportOptions.plist"
  cat >"$export_opts" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$team</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
EOF

  if xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$export_opts" \
      -exportPath "$work_dir/export-$scheme" -allowProvisioningUpdates >"$log_upload" 2>&1; then
    progress "[$scheme] UPLOADED $bundle $version ($build)"
  else
    grep -iE "error" "$log_upload" | head -20 || true
    progress "[$scheme] UPLOAD FAILED (see $log_upload)"
    failed+=("$scheme")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  echo "Failed: ${failed[*]}" >&2
  exit 1
fi
echo "All uploads succeeded. Builds appear in TestFlight after App Store Connect processing (~10-20 min)."
