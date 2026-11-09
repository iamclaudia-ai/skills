#!/usr/bin/env python3
"""Score Homebrew formulae by how often they are actually run.

usage: cli-usage.py [formula ...] [--days N] [--unassigned FILE]

With no formula names, scores the `brew` lines of ~/dotfiles/setup/unassigned.txt
(what catalog-apps found in no layer). Two usage sources:

  hist  Michael's ~/.zsh_history (low on purpose: he works through Claude)
  me    first tokens of Bash commands in Claude transcripts
        (~/.claude/projects/**/*.jsonl modified in the last N days, default 90)

Each formula's executables come from Homebrew's executables.txt (tap formulae:
the keg's bin/). Output is TSV: formula, hist, me, req|dep, used-by, description.
"dep" means installed as a dependency; "used-by" lists installed formulae that
depend on it, so removing it would pull them too.

Traps when reading the numbers: a formula can ship a binary with a common name
(mono ships `disco`, which is also our script); keg-only formulae (node@24) are
shadowed by mise; libpq's psql counts toward postgresql@N. Check before trusting a
high score.
"""
import argparse, glob, json, os, re, subprocess, time
from collections import Counter

p = argparse.ArgumentParser()
p.add_argument("formulae", nargs="*")
p.add_argument("--days", type=int, default=90)
p.add_argument("--unassigned", default=os.path.expanduser("~/dotfiles/setup/unassigned.txt"))
a = p.parse_args()

names = a.formulae or [l.split(None, 1)[1].strip() for l in open(a.unassigned) if l.startswith("brew ")]
if not names:
    raise SystemExit(f"no formulae given and no 'brew' lines in {a.unassigned}")

brew = lambda *args: subprocess.check_output(["brew", *args], text=True)
exes = {}
exe_file = os.path.join(brew("--cache").strip(), "api/internal/executables.txt")
if os.path.exists(exe_file):
    for line in open(exe_file):
        k, _, v = line.partition(":")
        exes[k] = v.split()
info = json.loads(brew("info", "--json=v2", "--installed"))["formulae"]
by = {f["name"]: f for f in info}
prefix = brew("--prefix").strip()
for f in info:  # tap formulae aren't in executables.txt: read the keg's bin/
    if f["name"] not in exes:
        keg = os.path.join(prefix, "opt", f["name"], "bin")
        exes[f["name"]] = os.listdir(keg) if os.path.isdir(keg) else []


def tokens(text):
    c = Counter()
    for seg in re.split(r"\|\||&&|[|;\n]", text):
        w = seg.strip().split()
        while w and ("=" in w[0] or w[0] in ("sudo", "time", "exec", "env", "command", "noglob")):
            w = w[1:]
        if w:
            c[os.path.basename(w[0].strip("'\"`("))] += 1
    return c


hist_path = os.path.expanduser("~/.zsh_history")
hist = tokens(re.sub(r"^: \d+:\d+;", "", open(hist_path, errors="ignore").read(), flags=re.M)) if os.path.exists(hist_path) else Counter()

cutoff = time.time() - a.days * 86400
cmds = []
for path in glob.glob(os.path.expanduser("~/.claude/projects/**/*.jsonl"), recursive=True):
    if os.path.getmtime(path) < cutoff:
        continue
    for line in open(path, errors="ignore"):
        if '"Bash"' not in line:
            continue
        try:
            content = json.loads(line).get("message", {}).get("content", [])
        except (json.JSONDecodeError, AttributeError):
            continue
        if not isinstance(content, list):
            continue
        for item in content:
            if isinstance(item, dict) and item.get("type") == "tool_use" and item.get("name") == "Bash":
                cmds.append(item.get("input", {}).get("command", ""))
me = tokens("\n".join(cmds))

uses = {}
for f in info:
    for d in f.get("dependencies", []):
        uses.setdefault(d, []).append(f["name"])

print(f"# {len(cmds)} Claude Bash commands from the last {a.days} days")
print("formula\thist\tme\treq\tused-by\tdesc")
for n in names:
    s = n.split("/")[-1]
    f = by.get(s) or by.get(n) or {}
    ex = exes.get(s, []) or [s]
    req = (f.get("installed") or [{}])[0].get("installed_on_request")
    print(f"{n}\t{sum(hist[e] for e in ex)}\t{sum(me[e] for e in ex)}\t{'?' if not f else 'req' if req else 'dep'}\t"
          f"{','.join(uses.get(s, []))[:40]}\t{(f.get('desc') or '')[:70]}")
