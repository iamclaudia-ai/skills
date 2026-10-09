"""Undo the last edit (Cmd+Z) in the tab that made it, then screenshot.

Usage: undo.py <tabId> <screenshot.png>
Only works in the same tab as the edit: Docs keeps undo history per tab. One paste is one undo.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from common import dx, fail

if len(sys.argv) < 3:
    fail("usage: undo <tabId> <screenshot.png>")

tab, shot_path = sys.argv[1], os.path.abspath(sys.argv[2])

UNDO_JS = """
var target = document.querySelector('.docs-texteventtarget-iframe').contentDocument.querySelector('[contenteditable]');
target.focus();
var keys = { bubbles: true, cancelable: true, key: 'z', code: 'KeyZ', keyCode: 90, which: 90, metaKey: true };
target.dispatchEvent(new KeyboardEvent('keydown', keys));
target.dispatchEvent(new KeyboardEvent('keyup', keys));
"""

dx("use_tab", "--tabId", tab)
dx("exec", "--script", UNDO_JS)
time.sleep(2.0)
dx("screenshot", "--out", shot_path)
print(f"Sent Cmd+Z in tab {tab}. Check {shot_path}, then close the tab when done.")
