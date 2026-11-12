# Lower bound on how much of a cloned SQLite db no longer shares blocks with its source:
# compares the two files in 4 KB pages (SQLite page = APFS block). Usage: pagediff.py <seed.db> <clone.db>
import sys

a, b = sys.argv[1], sys.argv[2]
P = 4096
same = diff = extra = 0
with open(a, "rb") as fa, open(b, "rb") as fb:
    while True:
        x = fa.read(P)
        y = fb.read(P)
        if not x and not y:
            break
        if not x:
            extra += 1
        elif not y:
            pass
        elif x == y:
            same += 1
        else:
            diff += 1


def mb(n):
    return n * P / 1048576


print(f"same {same} pages ({mb(same):.0f} MB), differ {diff} ({mb(diff):.0f} MB), past seed end {extra} ({mb(extra):.0f} MB)")
