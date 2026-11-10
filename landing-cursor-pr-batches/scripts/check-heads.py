#!/usr/bin/env python3
"""Has the bot moved any PR head since we merged it, and is every merged head in HEAD?

Usage: check-heads.py <work> [PR ...]     (default: every PR in merged-heads.json)
Run before pushing a group and again before merging it. A moved head means the bot pushed or rebased after we
merged, so GitHub will not mark that PR merged when the group lands. Options, in order:
  1. While the group is still being built: if `git merge-tree --write-tree HEAD <new head>` changes nothing
     outside the lockfile, merge the new head too (merge-heads.py after snapshot-prs.py), keep our lockfile,
     and confirm the tree is unchanged. GitHub then marks it merged.
  2. After the group lands: close it by hand with after-merge.py --close.
"""
import os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_common import is_ancestor, load_merged

work = sys.argv[1]
wanted = {int(arg) for arg in sys.argv[2:]}
merged = {number: sha for number, sha in load_merged(work).items() if not wanted or number in wanted}
listing = subprocess.run(["git", "ls-remote", "origin", *[f"refs/pull/{number}/head" for number in merged]],
                         capture_output=True, text=True, check=True).stdout
live = {int(ref.split("/")[2]): sha for sha, ref in (line.split("\t") for line in listing.splitlines())}
moved = [f"#{number} {sha[:9]}->{live.get(number, 'GONE')[:9]}" for number, sha in sorted(merged.items()) if live.get(number) != sha]
missing = [number for number, sha in sorted(merged.items()) if not is_ancestor(sha, "HEAD")]
print(f"{len(merged)} merged heads; moved: {', '.join(moved) or 'none'}; not in HEAD: {missing or 'none'}")
sys.exit(1 if moved or missing else 0)
