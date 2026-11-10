#!/usr/bin/env python3
"""Print every package whose installed versions differ between two pnpm deploy directories.

Usage: python3 -I compare-trees.py <deploy-dir-a> <deploy-dir-b>
Reads node_modules/.pnpm entry names, so it works on a deploy directory or a container's
node_modules copied out with `docker cp`.
"""
import os
import re
import sys


def installed_versions(deploy_dir):
    store = os.path.join(deploy_dir, "node_modules", ".pnpm")
    versions = {}
    for entry in os.listdir(store):
        if entry in ("node_modules", "lock.yaml"):
            continue
        base = entry.split("_")[0]
        if base.startswith("@"):
            base = base.replace("+", "/", 1)
        match = re.match(r"^(@?[^@]+)@(.+)$", base)
        if match:
            versions.setdefault(match.group(1), set()).add(match.group(2))
    return versions


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    first, second = (installed_versions(path) for path in sys.argv[1:])
    differing = sorted(
        name for name in set(first) | set(second) if first.get(name) != second.get(name)
    )
    print(f"{len(first)} vs {len(second)} packages, {len(differing)} differ")
    for name in differing:
        print(f"{name}: {sorted(first.get(name, []))} -> {sorted(second.get(name, []))}")


if __name__ == "__main__":
    main()
