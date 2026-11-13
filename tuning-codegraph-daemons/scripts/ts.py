# Prefix each stdin line with seconds since start: <cmd> 2>&1 | python3 -I ts.py
import sys
import time

start = time.time()
for line in sys.stdin:
    if line.strip() in ("", "│"):
        continue
    sys.stdout.write(f"{time.time() - start:6.1f} {line}")
    sys.stdout.flush()
