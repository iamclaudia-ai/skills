#!/usr/bin/env python3
"""Merge each PR's current head, unchanged, into the checked-out branch with one --no-ff merge per PR.

Usage: merge-heads.py <work> <PR> [PR ...]
- Reads head SHAs from <work>/prs.json (refresh it with snapshot-prs.py first) and records each merged head and
  its base in <work>/merged-heads.json, which verify-lock.py, check-heads.py and after-merge.py read later.
- Auto-resolves only pnpm-lock.yaml (keep ours; regenerate once at the end) and pnpm-workspace.yaml
  (union of both sides' lines, then a duplicate override key check). Anything else stops for a human:
  resolve, `git commit --no-edit`, and re-run with the same PR list (the finished merge gets recorded then).
- Re-runnable: heads already in HEAD are skipped.
Never push to the bot's branches; we only ever read them.
"""
import os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_common import duplicate_override_keys, git, is_ancestor, load_prs, load_records, save_records


def union_resolve(path):
    text = open(path).read()
    pattern = re.compile(r"<<<<<<< [^\n]*\n(.*?)(?:\|\|\|\|\|\|\| [^\n]*\n.*?)?=======\n(.*?)>>>>>>> [^\n]*\n", re.S)
    open(path, "w").write(pattern.sub(lambda match: union_lines(match.group(1), match.group(2)), text))


def union_lines(ours, theirs):
    seen = set(ours.splitlines())
    extra = [line for line in theirs.splitlines() if line not in seen]
    return ours + ("\n".join(extra) + "\n" if extra else "")


work, numbers = sys.argv[1], [int(arg) for arg in sys.argv[2:]]
prs, records = load_prs(work), load_records(work)
git("fetch", "-q", "origin", "main")
for number in numbers:
    pr = prs[number]
    sha = pr["headRefOid"]
    git("fetch", "-q", "origin", f"+refs/pull/{number}/head:refs/remotes/origin/pr/{number}")
    if is_ancestor(sha, "origin/main"):
        sys.exit(f"#{number}: head {sha[:9]} is already on main; nothing to merge")
    record = {"head": sha, "base": git("merge-base", "origin/main", sha).stdout.strip()}
    if is_ancestor(sha, "HEAD"):
        records.setdefault(number, record)
        save_records(work, records)
        print(f"skip #{number} (head {sha[:9]} already in HEAD)")
        continue
    message = f"Merge #{number} ({pr['headRefName']}): {pr['title']}"
    result = git("merge", "--no-ff", "--no-edit", "-m", message, sha, check=False)
    if result.returncode != 0:
        conflicted = git("diff", "--name-only", "--diff-filter=U").stdout.split()
        if git("rev-parse", "-q", "--verify", "MERGE_HEAD", check=False).returncode != 0 or not conflicted:
            sys.exit(f"#{number}: merge failed without conflicts:\n{result.stdout}\n{result.stderr}")
        for path in conflicted:
            if path == "pnpm-lock.yaml":
                git("checkout", "--ours", path)
                git("add", path)
            elif path == "pnpm-workspace.yaml":
                union_resolve(path)
                dupes = duplicate_override_keys(open(path).read())
                if dupes:
                    sys.exit(f"#{number}: duplicate override keys after union: {dupes}. Keep the stricter value, "
                             "`git add`, `git commit --no-edit`, re-run.")
                git("add", path)
        remaining = git("diff", "--name-only", "--diff-filter=U").stdout.split()
        if remaining:
            sys.exit(f"#{number}: needs a human for {remaining}. Resolve, `git commit --no-edit`, re-run.")
        git("commit", "--no-edit", "--no-verify")
        print(f"merged #{number} (auto-resolved {conflicted})")
    else:
        print(f"merged #{number} clean")
    records[number] = record
    save_records(work, records)
print(f"{len(records)} heads recorded in {work}/merged-heads.json. Next: regenerate the lockfile once, then verify-lock.py.")
