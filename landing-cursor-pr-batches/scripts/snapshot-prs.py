#!/usr/bin/env python3
"""Snapshot a batch of bot PRs into <work>/prs.json and fetch their heads.

Usage: snapshot-prs.py <work> [--author app/cursor] [--state open] [--search "fix(cve) in:title"] [--limit 300]
Leave statusCheckRollup and files out of `gh pr list --json`: on ~90 PRs they time out the GraphQL API (502/504).
File lists come from git instead (merge-base with origin/main .. head).
Per-PR CI and review state come from compare-prs.sh or `gh pr view`.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_common import git, gh_json

parser = argparse.ArgumentParser()
parser.add_argument("work")
parser.add_argument("--author", default="app/cursor")
parser.add_argument("--state", default="open")
parser.add_argument("--search", default="")
parser.add_argument("--limit", default="300")
args = parser.parse_args()

os.makedirs(args.work, exist_ok=True)
command = ["pr", "list", "--author", args.author, "--state", args.state, "--limit", args.limit,
           "--json", "number,title,headRefName,headRefOid,isDraft,reviewDecision,state,createdAt,assignees"]
if args.search:
    command += ["--search", args.search]
prs = gh_json(*command)

# refs/pull/N/head survives the branch being deleted on merge, and its objects are what headRefOid names.
refs = [f"+refs/pull/{pr['number']}/head:refs/remotes/origin/pr/{pr['number']}" for pr in prs]
for start in range(0, len(refs), 40):
    git("fetch", "-q", "origin", *refs[start:start + 40], check=False)
git("fetch", "-q", "origin", "main")

for pr in prs:
    pr["assignees"] = [person["login"] for person in pr["assignees"]]
    base = git("merge-base", "origin/main", pr["headRefOid"], check=False).stdout.strip()
    pr["fileList"] = git("diff", "--name-only", base, pr["headRefOid"], check=False).stdout.split() if base else []
json.dump(sorted(prs, key=lambda pr: pr["number"]), open(os.path.join(args.work, "prs.json"), "w"), indent=1)

cve = [pr for pr in prs if pr["headRefName"].startswith("cve/") or "(cve)" in pr["title"]]
print(f"{len(prs)} PRs -> {args.work}/prs.json ({len(cve)} CVE, {len(prs) - len(cve)} other); "
      f"{sum(pr['isDraft'] for pr in prs)} drafts, {sum(pr['reviewDecision'] == 'APPROVED' for pr in prs)} approved, "
      f"{sum(bool(pr['assignees']) for pr in prs)} claimed")
