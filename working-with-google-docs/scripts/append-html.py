"""Paste HTML at the very end of a Google Doc, as one undoable edit.

Usage: append-html.py <doc-url-or-id> <content.html> <screenshot.png> [profile]

The tab is LEFT OPEN and its id printed: Docs keeps undo history per tab, so `undo` only works in
the tab that made the edit. Verify with read-doc, then run `undo <tabId>` or close the tab.

HTML that Docs maps well: <h1>-<h3>, <p>, <b>/<i>, <ul>/<ol>, <table>. Table cells need inline
borders (style="border:1pt solid #000000;padding:5pt") or Docs imports them borderless.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from common import arg_profile, dx, fail, open_doc

if len(sys.argv) < 4:
    fail("usage: append-html <doc-url-or-id> <content.html> <screenshot.png> [profile]")

source, html_path, shot_path = sys.argv[1], sys.argv[2], os.path.abspath(sys.argv[3])
markup = open(html_path).read()
plain = markup  # Docs prefers text/html; plain text is only a fallback.

FOCUS_END_JS = """
var target = document.querySelector('.docs-texteventtarget-iframe').contentDocument.querySelector('[contenteditable]');
target.focus();
var keys = { bubbles: true, cancelable: true, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, metaKey: true };
target.dispatchEvent(new KeyboardEvent('keydown', keys));
target.dispatchEvent(new KeyboardEvent('keyup', keys));
"""

PASTE_JS = """
var target = document.querySelector('.docs-texteventtarget-iframe').contentDocument.querySelector('[contenteditable]');
target.focus();
var data = new window.DataTransfer();
data.setData('text/html', %s);
data.setData('text/plain', %s);
var paste = new window.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
target.dispatchEvent(paste);
window.__gdPasted = paste.defaultPrevented;
"""

open_doc(source, arg_profile(sys.argv, 4))
tab = dx("session_tabs")["current"]

# Cmd+Down lands in the empty paragraph Docs always keeps after a final table, so the paste
# never ends up inside the last table's cell.
dx("exec", "--script", FOCUS_END_JS)
time.sleep(1.5)
dx("exec", "--script", PASTE_JS % (json.dumps(markup), json.dumps(plain)))
time.sleep(2.5)
if not dx("eval", "--expression", "window.__gdPasted"):
    fail(f"Docs did not handle the paste (tab {tab} left open)")
dx("screenshot", "--out", shot_path)

print(f"Pasted at the end of the doc. Tab {tab} is still open.")
print(f"Screenshot: {shot_path}")
print("Next: read-doc to verify placement, then `undo " + str(tab) + "` to revert, or close the tab:")
print(f"  anima dominatrix close_tab --tabId {tab}")
