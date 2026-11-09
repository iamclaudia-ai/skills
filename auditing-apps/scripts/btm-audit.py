#!/usr/bin/env python3
"""Parse `sfltool dumpbtm` output; list login/background items, flag Trash or missing targets."""
import os, re, sys

text = open(sys.argv[1]).read()
items, cur = [], None
for line in text.splitlines():
    if re.match(r"^\s*#\d+:\s*$", line):
        cur = {}
        items.append(cur)
        continue
    m = re.match(r"^\s+([A-Za-z ]+):\s(.*)$", line)
    if cur is not None and m:
        cur.setdefault(m.group(1).strip(), m.group(2).strip())

by_id = {i.get("Identifier"): i for i in items}
seen = set()
for i in items:
    key = (i.get("Identifier"), i.get("URL"))
    if key in seen:
        continue
    seen.add(key)
    url = i.get("URL", "")
    path = url.replace("file://", "")
    if path.startswith("Contents/") and i.get("Parent Identifier") in by_id:
        path = by_id[i["Parent Identifier"]].get("URL", "").replace("file://", "").rstrip("/") + "/" + path
    path = re.sub(r"^/Users/501/", os.path.expanduser("~") + "/", path)
    flag = ""
    if ".Trash" in path:
        flag = "TRASH"
    elif path.startswith("/") and not os.path.exists(path.rstrip("/")):
        flag = "MISSING"
    enabled = "enabled" in i.get("Disposition", "") and "disabled" not in i.get("Disposition", "")
    print(f"{flag:8}|{'ON ' if enabled else 'off'}|{i.get('Type','?'):24}|{i.get('Name','?')}|{path}")
