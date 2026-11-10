#!/usr/bin/env python3
"""Group a batch's PRs that fix the same packages, so one keeper per group gets reviewed.

Usage: find-duplicates.py <work>
A PR's package set = the package in a `cve/<ecosystem>-<pkg>` branch name, plus the names behind override keys it
adds or changes in pnpm-workspace.yaml, plus the dependency names whose specifiers it changes in any package.json
or Gemfile. Titles are not used: the older wave's titles are free-form ("consolidate X", "ReDoS in X").
PRs sharing any package land in one group (union-find). Groups overlap broadly by design; read before closing.
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_common import git, load_prs, show, workspace_overrides

work = sys.argv[1]
prs = load_prs(work)


def override_name(key):
    last = re.split(r">(?!=)", key)[-1]  # parent>child selectors, but not a ">=" range
    match = re.match(r"^(@[^/@]+/[^@]+|[^@]+)", last)
    return match.group(1) if match else last


def changed_dependency_names(base, head, path):
    names = set()
    diff = git("diff", "-U0", base, head, "--", path, check=False).stdout
    for line in diff.splitlines():
        if line[:1] in "+-" and not line.startswith(("+++", "---")):
            match = re.match(r'^[+-]\s*"((?:@[^/"]+/)?[^"]+)":\s*"[~^<>=*\d]', line)
            if match:
                names.add(match.group(1))
            match = re.match(r"^[+-]\s*gem ['\"]([^'\"]+)['\"]", line)
            if match:
                names.add(match.group(1))
    return names


packages = {}
for number, pr in prs.items():
    head = pr["headRefOid"]
    base = git("merge-base", "origin/main", head, check=False).stdout.strip()
    names = set()
    match = re.match(r"^cve/(?:npm|rubygems|pip|cargo)-(.+)$", pr["headRefName"])
    if match:
        names.add(match.group(1))
    if base:
        before, after = workspace_overrides(show(base, "pnpm-workspace.yaml")), workspace_overrides(show(head, "pnpm-workspace.yaml"))
        names |= {override_name(key) for key in set(after) if before.get(key) != after[key]}
        for path in pr["fileList"]:
            if path.endswith("package.json") or path.endswith("Gemfile"):
                names |= changed_dependency_names(base, head, path)
    packages[number] = names

parent = {number: number for number in prs}


def find(number):
    while parent[number] != number:
        parent[number] = parent[parent[number]]
        number = parent[number]
    return number


owners = {}
for number, names in packages.items():
    for name in names:
        if name in owners:
            parent[find(number)] = find(owners[name])
        else:
            owners[name] = number

groups = {}
for number in prs:
    groups.setdefault(find(number), []).append(number)

duplicates = [sorted(members) for members in groups.values() if len(members) > 1]
for members in sorted(duplicates, key=lambda members: -len(members)):
    shared = set.intersection(*(packages[number] for number in members)) or set.union(*(packages[number] for number in members))
    print(f"== {', '.join(sorted(shared))[:100]}")
    for number in members:
        pr = prs[number]
        flags = " ".join(filter(None, ["DRAFT" if pr["isDraft"] else "", pr["reviewDecision"] or "", ",".join(pr["assignees"])]))
        print(f"  #{number} {pr['createdAt'][:10]} {pr['headRefName']} [{flags}] {pr['title'][:70]}")
        print(f"      packages: {', '.join(sorted(packages[number]))[:150]}")
singles = sum(1 for members in groups.values() if len(members) == 1)
print(f"\n{len(duplicates)} duplicate groups ({sum(len(members) for members in duplicates)} PRs), {singles} singles")
json.dump({str(number): sorted(names) for number, names in packages.items()}, open(os.path.join(work, "packages.json"), "w"), indent=1)
