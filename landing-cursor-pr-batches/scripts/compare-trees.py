#!/usr/bin/env python3
"""Semantic diff of two refs' pnpm dependency state: overrides, patchedDependencies and lockfile packages.

Usage: compare-trees.py <refA> <refB>
Proves a regrouped or rebuilt branch resolves exactly what the earlier build did (expect drift only from
main's own changes in between, and from re-resolved ^ ranges; pin those back to the reviewed version).
"""
import os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from batch_common import lock_package_keys, show, workspace_overrides


def patched(text):
    match = re.search(r"^patchedDependencies:\n((?:  .*\n)+)", text, re.M)
    return set(match.group(1).splitlines()) if match else set()


ref_a, ref_b = sys.argv[1], sys.argv[2]
workspace_a, workspace_b = show(ref_a, "pnpm-workspace.yaml"), show(ref_b, "pnpm-workspace.yaml")
overrides_a, overrides_b = workspace_overrides(workspace_a), workspace_overrides(workspace_b)
differing = {key: (overrides_a.get(key), overrides_b.get(key)) for key in set(overrides_a) | set(overrides_b) if overrides_a.get(key) != overrides_b.get(key)}
print(f"overrides equal: {not differing} ({len(overrides_a)} vs {len(overrides_b)}) {differing or ''}")
patched_a, patched_b = patched(workspace_a), patched(workspace_b)
print(f"patchedDependencies equal: {patched_a == patched_b} only-A: {sorted(patched_a - patched_b)} only-B: {sorted(patched_b - patched_a)}")
lock_a, lock_b = lock_package_keys(show(ref_a, "pnpm-lock.yaml")), lock_package_keys(show(ref_b, "pnpm-lock.yaml"))
print(f"lockfile package sets equal: {lock_a == lock_b} ({len(lock_a)} vs {len(lock_b)})")
print(f"  only-A: {sorted(lock_a - lock_b)[:12]}")
print(f"  only-B: {sorted(lock_b - lock_a)[:12]}")
