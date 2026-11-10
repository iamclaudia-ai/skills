"""Shared helpers for the landing-cursor-pr-batches scripts. Run every script from the repo root.

The work dir (e.g. ./tmp/cursor-cve) holds:
  prs.json           snapshot-prs.py output: the batch's PRs with head SHAs and file lists
  merged-heads.json  {PR number: {"head": SHA we merged, "base": its merge-base with main at merge time}},
                     written by merge-heads.py. It survives the bot rebasing its branches later, so never rebuild
                     it from live heads. The base must be captured before the group lands: afterwards the head is
                     on main and merge-base(main, head) is the head itself, which makes every PR diff look empty.
"""
import json, os, re, subprocess, sys, time


def git(*args, check=True):
    # A turn-end snapshot hook can briefly hold index.lock; retry instead of misreading it as a conflict.
    for _attempt in range(20):
        result = subprocess.run(["git", *args], capture_output=True, text=True)
        if "index.lock" not in result.stderr:
            break
        time.sleep(1)
    if check and result.returncode != 0:
        sys.exit(f"git {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")
    return result


def gh_json(*args):
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"gh {' '.join(args)} failed:\n{result.stderr}")
    return json.loads(result.stdout)


def is_ancestor(sha, ref):
    return git("merge-base", "--is-ancestor", sha, ref, check=False).returncode == 0


def load_prs(work):
    path = os.path.join(work, "prs.json")
    if not os.path.exists(path):
        sys.exit(f"{path} missing: run snapshot-prs.py {work} first")
    return {pr["number"]: pr for pr in json.load(open(path))}


def load_records(work):
    """{PR number: {"head": sha, "base": sha}} from merged-heads.json."""
    path = os.path.join(work, "merged-heads.json")
    return {int(number): record for number, record in json.load(open(path)).items()} if os.path.exists(path) else {}


def load_merged(work):
    """{PR number: head SHA we merged}."""
    return {number: record["head"] for number, record in load_records(work).items()}


def save_records(work, records):
    path = os.path.join(work, "merged-heads.json")
    json.dump({str(number): record for number, record in sorted(records.items())}, open(path, "w"), indent=1)


LOCK_KEY = re.compile(r"^  '?((?:@[^/@\s]+/)?[^@\s']+)@([0-9][^(':\s]*)'?:\s*$")


def lock_package_keys(text):
    """(name, version) pairs from the packages: section of a pnpm-lock.yaml."""
    keys, inside = set(), False
    for line in text.splitlines():
        if line.startswith("packages:"):
            inside = True
        elif inside and re.match(r"^\S", line):
            inside = False
        elif inside:
            match = LOCK_KEY.match(line)
            if match:
                keys.add((match.group(1), match.group(2)))
    return keys


def workspace_overrides(text):
    """The overrides: block of pnpm-workspace.yaml as {key: value}."""
    out, inside = {}, False
    for line in text.splitlines():
        if line.startswith("overrides:"):
            inside = True
            continue
        if inside and re.match(r"^\S", line):
            inside = False
        match = re.match(r"^  ('[^']+'|\"[^\"]+\"|[^#\s][^:]*):\s*(.+)$", line) if inside else None
        if match:
            out[match.group(1).strip("'\"")] = match.group(2).strip().strip("'\"")
    return out


def duplicate_override_keys(text):
    keys, dupes, inside = set(), [], False
    for line in text.splitlines():
        if line.startswith("overrides:"):
            inside = True
            continue
        if inside and re.match(r"^\S", line):
            break
        match = re.match(r"^  ('[^']+'|\"[^\"]+\"|[^#\s][^:]*):", line) if inside else None
        if match:
            key = match.group(1).strip("'\"")
            if key in keys:
                dupes.append(key)
            keys.add(key)
    return dupes


def show(ref, path):
    result = git("show", f"{ref}:{path}", check=False)
    return result.stdout if result.returncode == 0 else ""


def version_tuple(version):
    return tuple(int(part) if part.isdigit() else 0 for part in re.split(r"[.\-+]", version)[:3])


def adds_nothing(head, onto="origin/main"):
    """True when merging `head` into main changes nothing outside lockfiles (empty conflict hunks count as nothing)."""
    tree = git("merge-tree", "--write-tree", onto, head, check=False).stdout.split("\n")[0].strip()
    diff = git("diff", onto, tree, "--", ".", ":!pnpm-lock.yaml", ":!Gemfile.lock", check=False).stdout
    changed = [line for line in diff.splitlines() if line[:1] in "+-" and not line.startswith(("+++", "---"))]
    return all(re.match(r"^\+(<<<<<<<|=======|>>>>>>>)", line) for line in changed)
