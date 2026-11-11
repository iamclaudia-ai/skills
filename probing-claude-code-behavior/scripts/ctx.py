"""Print unique context windows around terms in a strings dump of the Claude Code binary.

grep with .{0,N} hangs on the minified lines, so search with this instead.

usage: python3 -I ctx.py <strings.txt> <width> <term> [<term> ...]
"""
import sys

path, width, terms = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
data = open(path, encoding="utf-8", errors="replace").read()
seen = set()
for term in terms:
    start = 0
    while True:
        i = data.find(term, start)
        if i < 0:
            break
        snippet = data[max(0, i - width) : i + len(term) + width].replace("\n", " ⏎ ")
        if snippet not in seen:
            seen.add(snippet)
            print(f"[{term}] {snippet}\n")
        start = i + 1
