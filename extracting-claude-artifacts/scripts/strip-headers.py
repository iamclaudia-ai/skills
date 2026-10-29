"""Remove every request and response header and cookie from a HAR, in place.

Usage: strip-headers.py <capture.har>

Extraction only needs URLs, statuses and bodies, while headers and cookies carry the capturing
browser's session. Safe to run more than once. Writes a temporary file beside the HAR and swaps
it in, so an interrupted run leaves the original untouched.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from har_artifacts import fail

if len(sys.argv) != 2:
    fail("usage: strip-headers <capture.har>")

har_path = os.path.abspath(sys.argv[1])
try:
    with open(har_path, encoding="utf-8") as har_file:
        har = json.load(har_file)
except (OSError, json.JSONDecodeError) as error:
    fail(f"could not read HAR {har_path}: {error}")

entries = har.get("log", {}).get("entries", [])
removed_headers = 0
removed_cookies = 0
for entry in entries:
    for side in ("request", "response"):
        message = entry.get(side, {})
        removed_headers += len(message.get("headers", []))
        removed_cookies += len(message.get("cookies", []))
        message["headers"] = []
        message["cookies"] = []
        message["headersSize"] = -1

temporary_path = f"{har_path}.stripping"
with open(temporary_path, "w", encoding="utf-8") as out:
    json.dump(har, out)
os.replace(temporary_path, har_path)

print(f"stripped {removed_headers:,} headers and {removed_cookies:,} cookies from {len(entries):,} entries")
