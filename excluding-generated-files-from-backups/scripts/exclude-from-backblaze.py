#!/usr/bin/env python3
"""Add Backblaze name rules that skip regenerable folders (node_modules, .git, venv...) anywhere.

Backblaze reads custom rules from bzinfo.xml (world-writable, no root needed). A rule excludes
every file whose lowercased path contains /<name>/. Idempotent: existing rules are left alone.
Backblaze applies them at its next file scan (hourly). Usage: exclude-from-backblaze.py [--dry-run]
"""
import re
import shutil
import sys
import time

BZINFO = "/Library/Backblaze.bzpkg/bzdata/bzinfo.xml"
# Same "always regenerable" list as ALWAYS in generated-names.sh. Backblaze can't ask git whether
# a folder is ignored, so generic names (dist, build...) stay backed up there.
NAMES = ["node_modules", ".git", "venv", ".venv", "__pycache__", ".next", ".nuxt", ".svelte-kit",
         ".turbo", ".expo", ".parcel-cache", ".nxcache", ".gradle", "DerivedData", ".codegraph",
         ".pytest_cache", ".mypy_cache", ".ruff_cache"]
RULE = ('    <excludefname_rule plat="mac" osVers="*" ruleIsOptional="t" '
        'skipFirstCharThenStartsWith="*" contains_1="/{name}/" contains_2="*" '
        'doesNotContain="*" endsWith="*" hasFileExtension="*" />\n')

xml = open(BZINFO).read()
have = set(re.findall(r'contains_1="/([^"/]+)/"', xml))
missing = [n.lower() for n in NAMES if n.lower() not in have]
print(f"{len(have)} name rules present, {len(missing)} to add: {', '.join(missing) or '-'}")
if not missing or "--dry-run" in sys.argv:
    sys.exit(0)

shutil.copy(BZINFO, f"{BZINFO}.bak-{time.strftime('%Y%m%d%H%M%S')}")
rules = "".join(RULE.format(name=n) for n in missing)
open(BZINFO, "w").write(xml.replace("</do_backup>", rules + "</do_backup>", 1))
print("added; Backblaze picks them up at its next file scan")
