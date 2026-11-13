# Summarize V8 .cpuprofile files: wall span and top self-time functions.
# Usage: python3 -I cpuprof.py <file.cpuprofile>...
import json
import sys
from collections import Counter

for path in sys.argv[1:]:
    with open(path) as f:
        prof = json.load(f)
    nodes = {n["id"]: n for n in prof["nodes"]}
    deltas = prof.get("timeDeltas", [])
    self_us = Counter()
    for sample, dt in zip(prof.get("samples", []), deltas):
        frame = nodes[sample]["callFrame"]
        url = frame.get("url", "").split("/dist/")[-1]
        self_us[f'{frame["functionName"] or "(anon)"} {url}:{frame.get("lineNumber", 0) + 1}'] += dt
    span = (prof["endTime"] - prof["startTime"]) / 1e6
    print(f"== {path.rsplit('/', 1)[-1]}: span {span:.1f}s")
    for name, us in self_us.most_common(8):
        print(f"   {us / 1e6:6.1f}s  {name}")
    # Who calls the hottest native frame: the nearest codegraph (dist/) frames above it.
    parent = {}
    for n in prof["nodes"]:
        for c in n.get("children", []):
            parent[c] = n["id"]
    callers = Counter()
    for sample, dt in zip(prof.get("samples", []), deltas):
        if nodes[sample]["callFrame"]["functionName"] != "readFileUtf8":
            continue
        chain, cur = [], parent.get(sample)
        while cur is not None and len(chain) < 3:
            frame = nodes[cur]["callFrame"]
            if "/dist/" in frame.get("url", ""):
                chain.append(f'{frame["functionName"] or "(anon)"} {frame["url"].split("/dist/")[-1]}:{frame.get("lineNumber", 0) + 1}')
            cur = parent.get(cur)
        callers[" <- ".join(chain)] += dt
    for chain, us in callers.most_common(4):
        print(f"   readFileUtf8 {us / 1e6:5.1f}s via {chain}")
