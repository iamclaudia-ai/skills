#!/usr/bin/env bash
# list-displays.sh — show every display's geometry and its seamless crop window.
# Use this to find the arrangement's bounding box (= the size your canvas must be)
# and to spot any display whose crop you'll want to override (e.g. a prompter).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
{
  printf 'ID\tNAME\tORIGIN_X\tORIGIN_Y\tW\tH\tSEAMLESS_CROP\n'
  swift "$HERE/displays.swift" list 2>/dev/null
} | column -t -s $'\t'
# bbox goes to stderr from the swift tool:
swift "$HERE/displays.swift" list 2>&1 1>/dev/null | sed -n 's/^bbox=/arrangement bounding box = /p'
