"""Post replies to existing comment threads, as whoever owns the Chrome profile.

Usage: post-replies.py <doc-url-or-id> <replies.json> [profile]

replies.json is a list of [thread_prefix, reply_text] pairs. thread_prefix is the opening text of
the thread's first comment; it must match exactly one open thread. A thread that already holds a
reply with the same text is skipped, so a run that dies halfway can simply be re-run.
Every post is verified (last message in the thread equals the text) before moving on, and the run
stops at the first failure.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from common import arg_profile, close_tab, dx, fail, norm, open_doc, wait_for

if len(sys.argv) < 3:
    fail("usage: post-replies <doc-url-or-id> <replies.json> [profile]")

source, replies_path = sys.argv[1], sys.argv[2]
replies = json.load(open(replies_path))

FIND_JS = """
var prefix = %s, text = %s;
var norm = function (s) { return s.replace(/\\s+/g, ' ').trim(); };
var matches = Array.from(document.querySelectorAll('.docos-anchoreddocoview')).filter(function (d) {
  var body = d.querySelector('.docos-replyview-body');
  return body && norm(body.innerText).indexOf(norm(prefix)) === 0;
});
window.__gdThread = matches.length === 1 ? matches[0] : null;
if (matches.length !== 1) {
  window.__gdStatus = 'MATCHES=' + matches.length;
} else {
  var bodies = Array.from(matches[0].querySelectorAll('.docos-replyview-body')).map(function (b) { return norm(b.innerText); });
  window.__gdStatus = bodies.indexOf(norm(text)) !== -1 ? 'SKIP' : 'FOUND';
  if (window.__gdStatus === 'FOUND') { matches[0].click(); }
}
"""

# Docs resets the reply box when it gains focus, so the focus events must come before the text.
FILL_JS = """
var box = window.__gdThread.querySelector('.docos-input-contenteditable');
var text = %s;
box.focus();
box.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
box.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
box.textContent = text;
box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
box.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
"""

POST_VISIBLE_JS = "window.__gdThread.querySelector('.docos-input-post').offsetParent !== null"

CLICK_POST_JS = """
var button = window.__gdThread.querySelector('.docos-input-post');
button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
"""

LAST_BODY_JS = """
var rows = window.__gdThread.querySelectorAll('.docos-replyview');
var last = rows[rows.length - 1];
last.querySelector('.docos-replyview-body').innerText
"""

open_doc(source, arg_profile(sys.argv, 3))
posted = skipped = 0
try:
    wait_for("document.querySelectorAll('.docos-anchoreddocoview').length", timeout=15)
    for index, (prefix, text) in enumerate(replies):
        label = f"[{index}] {prefix[:50]}"
        dx("exec", "--script", FIND_JS % (json.dumps(prefix), json.dumps(text)))
        status = dx("eval", "--expression", "window.__gdStatus")
        if status == "SKIP":
            skipped += 1
            print(f"{label}: skip, already replied")
            continue
        if status != "FOUND":
            fail(f"{label}: thread not found uniquely ({status})")
        time.sleep(1.2)
        dx("exec", "--script", FILL_JS % json.dumps(text))
        time.sleep(0.7)
        if not dx("eval", "--expression", POST_VISIBLE_JS):
            fail(f"{label}: Reply button never appeared, so nothing was posted")
        dx("exec", "--script", CLICK_POST_JS)
        time.sleep(2.5)
        landed = dx("eval", "--expression", LAST_BODY_JS) or ""
        if norm(landed) != norm(text):
            fail(f"{label}: posted text did not verify (last message: {landed[:80]!r})")
        posted += 1
        print(f"{label}: posted")
finally:
    close_tab()

print(f"Done: {posted} posted, {skipped} skipped")
