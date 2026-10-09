"""Show what changed between two comment snapshots: new threads, new replies, resolved threads.

Usage: diff-comments.py <old.json> <new.json>
Docs exposes no stable thread ids in the DOM, so a thread is keyed by its root author plus the
first 80 characters of its root comment.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from common import fail, norm

if len(sys.argv) < 3:
    fail("usage: diff-comments <old.json> <new.json>")


def load(path):
    threads = json.load(open(path))
    return {(thread["messages"][0]["author"], norm(thread["messages"][0]["body"])[:80]): thread for thread in threads}


old, new = load(sys.argv[1]), load(sys.argv[2])
changes = 0

for key, thread in new.items():
    if key not in old:
        changes += 1
        print(f"NEW THREAD ({key[0]}): {thread['messages'][0]['body']}")
        for message in thread["messages"][1:]:
            print(f"    {message['author']} {message['time']}: {message['body']}")
        print()
        continue
    fresh = thread["messages"][len(old[key]["messages"]):]
    if fresh:
        changes += 1
        print(f"NEW REPLIES on ({key[0]}): {key[1]}")
        for message in fresh:
            print(f"    {message['author']} {message['time']}: {message['body']}")
        print()

for key in old.keys() - new.keys():
    changes += 1
    print(f"GONE (resolved or deleted): {key[0]}: {key[1]}")

if not changes:
    print("No changes.")
