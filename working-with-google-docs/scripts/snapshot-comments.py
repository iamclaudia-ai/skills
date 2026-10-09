"""Save every open comment thread (author, time and text of each message) as JSON.

Usage: snapshot-comments.py <doc-url-or-id> <out.json | folder> [profile]
A folder gets a timestamped file name, so repeated snapshots sort in order.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from common import arg_profile, close_tab, fail, open_doc, read_threads

if len(sys.argv) < 3:
    fail("usage: snapshot-comments <doc-url-or-id> <out.json | folder> [profile]")

source, target = sys.argv[1], os.path.abspath(sys.argv[2])
if os.path.isdir(target):
    target = os.path.join(target, time.strftime("%Y-%m-%d-%H%M") + ".json")

open_doc(source, arg_profile(sys.argv, 3))
try:
    threads = read_threads()
finally:
    close_tab()

with open(target, "w") as handle:
    json.dump(threads, handle, indent=1, ensure_ascii=False)

replies = sum(len(thread["messages"]) - 1 for thread in threads)
print(f"Wrote {target}: {len(threads)} open threads, {replies} replies")
authors = {}
for thread in threads:
    for message in thread["messages"]:
        authors[message["author"]] = authors.get(message["author"], 0) + 1
for author, count in sorted(authors.items(), key=lambda item: -item[1]):
    print(f"  {author}: {count}")
