#!/usr/bin/env python3
"""After a group PR lands: prove it was a real merge, then account for every PR it included.

Usage: after-merge.py <work> <group PR> <PR> [PR ...] [--close]
1. The group PR's merge commit must have TWO parents. The subject line proves nothing: a squash of a PR keeps
   GitHub's "Merge pull request #N" title when the branch was itself built from merges.
2. Each included PR should now be MERGED. For any still OPEN, checks that the head we merged is on main and that
   its current head (the bot may have rebased it since) adds nothing main doesn't already have outside the
   lockfile. Those are listed as "landed"; with --close they are closed with a comment linking the group PR.
   Anything else is listed as NEEDS A LOOK and never closed.
"""
import os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_common import adds_nothing, git, gh_json, is_ancestor, load_merged

args = [arg for arg in sys.argv[1:] if arg != "--close"]
close = "--close" in sys.argv
work, group, numbers = args[0], int(args[1]), [int(arg) for arg in args[2:]]
merged = load_merged(work)
git("fetch", "-q", "origin", "main")

info = gh_json("pr", "view", str(group), "--json", "state,mergeCommit")
if info["state"] != "MERGED":
    sys.exit(f"#{group} is {info['state']}, not MERGED")
commit = info["mergeCommit"]["oid"]
parents = len(git("rev-list", "--parents", "-n1", commit).stdout.split()) - 1
print(f"#{group} merge commit {commit[:11]}: {parents} parent(s) {'OK' if parents == 2 else '!! SQUASHED: included PRs will not auto-mark; see the recovery recipe'}")


counts = {}
for number in numbers:
    pr = gh_json("pr", "view", str(number), "--json", "state,headRefOid")
    counts[pr["state"]] = counts.get(pr["state"], 0) + 1
    if pr["state"] != "OPEN":
        continue
    landed_sha = merged.get(number)
    git("fetch", "-q", "origin", f"+refs/pull/{number}/head:refs/remotes/origin/pr/{number}", check=False)
    if not landed_sha or not is_ancestor(landed_sha, "origin/main"):
        print(f"  #{number} OPEN, NEEDS A LOOK: merged head {str(landed_sha)[:9]} is not on main")
        continue
    if pr["headRefOid"] != landed_sha and not adds_nothing(pr["headRefOid"]):
        print(f"  #{number} OPEN, NEEDS A LOOK: current head {pr['headRefOid'][:9]} adds changes beyond main")
        continue
    print(f"  #{number} OPEN, landed at {landed_sha[:9]} (bot moved the head to {pr['headRefOid'][:9]})")
    if close:
        body = (f"This fix landed on main through #{group}, which merged this PR's head `{landed_sha[:9]}` unchanged. "
                "The branch was rebased afterwards (same change on a newer main), so GitHub can't mark it merged on "
                "its own. Closing it as landed.\n\nClaudia 💙")
        subprocess.run(["gh", "pr", "close", str(number), "--comment", body], check=True, capture_output=True)
        print(f"    closed #{number}")
print(f"states: {counts}")
