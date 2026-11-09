#!/usr/bin/env python3
"""List files Backblaze has uploaded that are no longer on this Mac, from its local upload logs.

Reads bz_done_*.dat (one tab-separated line per event; path last, size second to last):
  '+' uploaded   '=' re-upload / large-file chunk   '-' gone from the Mac (size 0)
Keeps paths under the given roots, skipping hidden folders and generated ones (node_modules...).
Writes <out>/missing.tsv (path, size, last upload, deleted at) and prints a summary per folder.

Usage: backblaze-missing-files.py <out-dir> [ROOT...]
  default roots: ~/Projects ~/Documents ~/Desktop ~/Pictures
"""
import glob
import os
import sys
from collections import defaultdict

DONE = "/Library/Backblaze.bzpkg/bzdata/bzbackup/bzdatacenter/bz_done_*.dat"
GENERATED = {"node_modules", "venv", "__pycache__", "dist", "build", "coverage", "target", "out",
             "DerivedData", "tmp", "log", "Pods"}

out_dir = sys.argv[1]
home = os.path.expanduser("~")
roots = [os.path.abspath(r) + "/" for r in sys.argv[2:]] or [
    f"{home}/{d}/" for d in ("Projects", "Documents", "Desktop", "Pictures")]


def wanted(path: str) -> bool:
    if not path.startswith(tuple(roots)):
        return False
    parts = path.split("/")[3:]  # after /Users/<name>
    return not any(p.startswith(".") or p in GENERATED for p in parts[:-1]) and \
        not parts[-1].startswith(".")


uploaded = {}  # path -> (size, last upload yyyymmddhhmmss)
deleted = {}  # path -> last deletion
for f in sorted(glob.glob(DONE)):
    with open(f, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 12:
                continue
            op, when, path = cols[1], cols[3], cols[-1]
            if not wanted(path):
                continue
            if op in "+=":
                uploaded[path] = (cols[-2], when)
            elif op == "-":
                deleted[path] = when

missing = [p for p in uploaded if not os.path.lexists(p)]
os.makedirs(out_dir, exist_ok=True)
by_folder = defaultdict(lambda: [0, 0])
with open(os.path.join(out_dir, "missing.tsv"), "w") as fh:
    fh.write("path\tsize\tlast_upload\tdeleted_at\n")
    for p in sorted(missing):
        size, when = uploaded[p]
        fh.write(f"{p}\t{size}\t{when}\t{deleted.get(p, '')}\n")
        key = "/".join(p.split("/")[3:6])
        by_folder[key][0] += 1
        by_folder[key][1] += int(size) if size.isdigit() else 0

print(f"{len(uploaded):,} files ever uploaded under {', '.join(roots)}; "
      f"{len(missing):,} no longer on disk ({sum(v[1] for v in by_folder.values()) / 1e9:.1f} GB)")
for key, (n, b) in sorted(by_folder.items(), key=lambda kv: -kv[1][1])[:40]:
    print(f"{n:>8,}  {b / 1e6:>10,.1f} MB  {key}")
