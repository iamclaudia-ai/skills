"""Shared helpers for driving Google Docs through DOMINATRIX (Michael's real Chrome)."""

import json
import re
import subprocess
import sys
import time

DEFAULT_PROFILE = "michael.carter@beehiiv.com"

# Docs draws the page on a canvas, but the comment sidebar is real DOM. Only open threads are
# rendered there, so a thread that disappears between snapshots was resolved or deleted.
THREADS_JS = """JSON.stringify(Array.from(document.querySelectorAll('.docos-anchoreddocoview')).map(d => {
  var messages = Array.from(d.querySelectorAll('.docos-replyview')).map(r => {
    var a = r.querySelector('.docos-author');
    var t = r.querySelector('.docos-replyview-timestamp span');
    var b = r.querySelector('.docos-replyview-body');
    return { author: a ? a.innerText : '', time: t ? t.innerText : '', body: b ? b.innerText : '' };
  });
  return { label: d.getAttribute('aria-label'), messages: messages };
}))"""


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def dx(method, *args, check=True):
    """Run one `anima dominatrix` command and return its parsed JSON result.

    With check=False a failed command returns False instead of exiting.
    """
    result = subprocess.run(["anima", "dominatrix", method, *args], capture_output=True, text=True)
    if result.returncode != 0:
        if not check:
            print(f"retrying: dominatrix {method}: {(result.stderr or result.stdout).strip()}", file=sys.stderr)
            return False
        fail(f"dominatrix {method}: {(result.stderr or result.stdout).strip()}")
    output = result.stdout.strip()
    try:
        return json.loads(output) if output else None
    except json.JSONDecodeError:
        return output


def doc_id(url_or_id):
    match = re.search(r"/document/d/([A-Za-z0-9_-]+)", url_or_id)
    if match:
        return match.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{20,}", url_or_id):
        return url_or_id
    fail(f"not a Google Doc URL or id: {url_or_id}")


def doc_url(url_or_id, view="edit"):
    return f"https://docs.google.com/document/d/{doc_id(url_or_id)}/{view}"


def open_doc(url_or_id, profile, view="edit", settle=6.0):
    """Open the doc in a fresh tab of our own (never one of Michael's) and let it load."""
    dx("navigate", "--tabId", "new", "--profile", profile, "--url", doc_url(url_or_id, view))
    time.sleep(settle)


def close_tab():
    dx("close_tab")


def wait_for(expression, timeout=20.0, interval=1.0):
    """Poll a JS expression until it returns something truthy."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = dx("eval", "--expression", expression)
        if value:
            return value
        time.sleep(interval)
    return None


def read_threads():
    wait_for("document.querySelectorAll('.docos-anchoreddocoview').length", timeout=15)
    raw = dx("eval", "--expression", THREADS_JS)
    return json.loads(raw) if isinstance(raw, str) else (raw or [])


def norm(text):
    return " ".join(text.split())


def arg_profile(argv, index):
    return argv[index] if len(argv) > index and argv[index] else DEFAULT_PROFILE
