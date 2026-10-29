"""Shared HAR reading for the claude.ai artifact commands.

A HAR holds the capturing browser's cookies and auth headers, so nothing here ever prints or writes
request/response headers, and URLs are printed without their query string (frame tokens live there).
"""

import base64
import json
import re
import sys
from urllib.parse import urlsplit

FRAME_HOST_SUFFIX = ".frame.claudeusercontent.com"
FRAME_PATH = re.compile(r"^/_f/([^/]+)/(.*)$")
RUNTIME_BLOCK = re.compile(r"<!-- frame-runtime -->.*?<!-- /frame-runtime -->", re.DOTALL)


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def load_entries(har_path):
    try:
        with open(har_path, encoding="utf-8") as har_file:
            har = json.load(har_file)
    except (OSError, json.JSONDecodeError) as error:
        fail(f"could not read HAR {har_path}: {error}")
    entries = har.get("log", {}).get("entries", [])
    if not entries:
        fail("the HAR has no entries")
    return entries


def safe_url(url):
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"


def frame_location(url):
    """(host, version, relative path) for a frame file, or None for anything else."""
    parts = urlsplit(url)
    if not parts.netloc.endswith(FRAME_HOST_SUFFIX):
        return None
    match = FRAME_PATH.match(parts.path)
    if not match:
        return None
    return parts.netloc, match.group(1), match.group(2)


def body_bytes(entry):
    content = entry.get("response", {}).get("content", {})
    text = content.get("text")
    if text is None:
        return None
    if content.get("encoding") == "base64":
        return base64.b64decode(text)
    return text.encode("utf-8")


def mime_type(entry):
    return entry.get("response", {}).get("content", {}).get("mimeType", "").split(";")[0].strip()


def strip_runtime(html):
    stripped, count = RUNTIME_BLOCK.subn("", html, count=1)
    return stripped, count == 1
