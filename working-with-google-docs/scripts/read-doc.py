"""Save a Google Doc's text as Markdown, read from the plain-HTML /mobilebasic view.

Usage: read-doc.py <doc-url-or-id> <out.md> [profile]
"""

import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from common import arg_profile, close_tab, dx, fail, open_doc

if len(sys.argv) < 3:
    fail("usage: read-doc <doc-url-or-id> <out.md> [profile]")

source, out_path = sys.argv[1], os.path.abspath(sys.argv[2])
open_doc(source, arg_profile(sys.argv, 3), view="mobilebasic", settle=3.0)
try:
    # A long doc can outlast get_markdown's 15s limit on a slow load; the retry hits a warm page.
    for attempt in range(3):
        if dx("get_markdown", "--out", out_path, check=False) is not False:
            break
        time.sleep(3)
    else:
        fail("get_markdown timed out three times")
finally:
    close_tab()

with open(out_path) as handle:
    text = handle.read()
headings = [line for line in text.splitlines() if re.match(r"#{1,6} \S", line)]
print(f"Wrote {out_path} ({len(text)} chars, {len(headings)} headings)")
for heading in headings:
    print(f"  {heading}")
