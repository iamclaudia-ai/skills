#!/usr/bin/env python3
"""Resolve every conflict hunk in a file to one side. Usage: resolve-side.py ours|theirs <path>"""
import re, sys

side, path = sys.argv[1], sys.argv[2]
text = open(path).read()
pattern = re.compile(r"^<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n", re.S | re.M)
resolved, count = pattern.subn(lambda match: match.group(1) if side == "ours" else match.group(2), text)
open(path, "w").write(resolved)
print(f"{path}: {count} hunk(s) -> {side}")
