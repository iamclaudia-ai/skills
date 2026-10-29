"""List what a HAR captured, without exposing anything secret.

Usage: list.py <capture.har> [--all]

Default: only claude.ai artifact frame files (*.frame.claudeusercontent.com/_f/<version>/...),
grouped by frame and version. --all lists every entry. Prints URL (query stripped), status, MIME
type and body size only, never headers or cookies.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from har_artifacts import body_bytes, fail, frame_location, load_entries, mime_type, safe_url

args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
show_all = "--all" in sys.argv
if len(args) != 1:
    fail("usage: list <capture.har> [--all]")

entries = load_entries(args[0])


def describe(entry):
    body = body_bytes(entry)
    size = "no body" if body is None else f"{len(body):,} B"
    status = entry.get("response", {}).get("status", "?")
    return f"{status}  {mime_type(entry) or '-':<24} {size:>12}"


if show_all:
    for entry in entries:
        print(f"{describe(entry)}  {safe_url(entry['request']['url'])}")
    sys.exit(0)

frames = {}
for entry in entries:
    location = frame_location(entry["request"]["url"])
    if location:
        host, version, path = location
        frames.setdefault((host, version), []).append((path, entry))

if not frames:
    fail(
        "no artifact frame files in this HAR. Was the artifact page open and fully loaded while "
        "capturing? Run with --all to see what was captured."
    )

for (host, version), files in frames.items():
    print(f"frame {host.split('.')[0]}  version {version}")
    for path, entry in files:
        print(f"  {describe(entry)}  /{path or '(page)'}")
