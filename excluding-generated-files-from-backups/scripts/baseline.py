#!/usr/bin/env python3 -I
"""Record a system activity baseline: per-process CPU over a window, disk0 I/O, memory.

Usage: baseline.py [seconds] [label] [out-dir]
Writes <out-dir>/<timestamp>-<label>.txt (default: current directory) and prints the same report.
"""
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime

DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 180
LABEL = sys.argv[2] if len(sys.argv) > 2 else "baseline"
INTERVAL = 5
OUT_DIR = sys.argv[3] if len(sys.argv) > 3 else os.getcwd()


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def cpu_seconds(t):
    days = 0
    if "-" in t:
        d, t = t.split("-", 1)
        days = int(d)
    secs = 0.0
    for part in t.split(":"):
        secs = secs * 60 + float(part)
    return days * 86400 + secs


def ps_snapshot():
    procs = {}
    for line in run(["ps", "-Ao", "pid=,user=,time=,comm="]).splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        pid, user, t, comm = parts
        procs[pid] = (user, cpu_seconds(t), os.path.basename(comm))
    return procs


def vm_stat():
    stats = {}
    for line in run(["vm_stat"]).splitlines()[1:]:
        m = re.match(r'"?(.+?)"?:\s+(\d+)', line)
        if m:
            stats[m.group(1)] = int(m.group(2))
    return stats


io_rows = []


def sample_io():
    count = DURATION // INTERVAL + 1
    out = run(["iostat", "-d", "-w", str(INTERVAL), "-c", str(count), "disk0"])
    for line in out.splitlines()[2:]:
        # iostat reprints its header every ~20 rows.
        try:
            nums = tuple(float(n) for n in line.split())
        except ValueError:
            continue
        if len(nums) == 3:
            io_rows.append(nums)


started = datetime.now()
print(f"Sampling for {DURATION}s...", file=sys.stderr)
ps0, vm0, t0 = ps_snapshot(), vm_stat(), time.time()
io_thread = threading.Thread(target=sample_io)
io_thread.start()
time.sleep(DURATION)
ps1, vm1, t1 = ps_snapshot(), vm_stat(), time.time()
io_thread.join()
elapsed = t1 - t0

lines = [f"# {LABEL}: {started:%Y-%m-%d %H:%M:%S}, {elapsed:.0f}s window", ""]

lines.append(f"load averages: {run(['sysctl', '-n', 'vm.loadavg']).strip()}")
lines.append(f"swap: {run(['sysctl', '-n', 'vm.swapusage']).strip()}")
pressure = run(["memory_pressure", "-Q"]).strip().splitlines()
lines.append(pressure[-1] if pressure else "memory_pressure: n/a")
page = 16384
for key, name in [("Pageins", "pageins"), ("Pageouts", "pageouts"), ("Swapins", "swapins"), ("Swapouts", "swapouts")]:
    delta = vm1.get(key, 0) - vm0.get(key, 0)
    lines.append(f"{name} during window: {delta} ({delta * page / 1e6:.1f} MB)")
lines.append("")

# First iostat row is the since-boot average; drop it.
live = io_rows[1:]
if live:
    tps = [r[1] for r in live]
    mbs = [r[2] for r in live]
    lines.append(f"disk0 ({len(live)} x {INTERVAL}s samples)")
    lines.append(f"  tps   avg {sum(tps)/len(tps):8.1f}   max {max(tps):8.0f}")
    lines.append(f"  MB/s  avg {sum(mbs)/len(mbs):8.2f}   max {max(mbs):8.2f}")
    lines.append("")

usage = []
for pid, (user, cpu1, comm) in ps1.items():
    cpu0 = ps0.get(pid, (None, 0.0, None))[1]
    pct = (cpu1 - cpu0) / elapsed * 100
    if pct > 0:
        usage.append((pct, pid, user, comm))
usage.sort(reverse=True)
total = sum(u[0] for u in usage)
ncpu = int(run(["sysctl", "-n", "hw.ncpu"]).strip())
lines.append(f"CPU over window: {total:.1f}% of one core in total ({total / ncpu:.1f}% of {ncpu} cores)")
lines.append(f"  {'%CPU':>6}  {'PID':>6}  {'USER':<14} COMMAND")
for pct, pid, user, comm in usage[:25]:
    lines.append(f"  {pct:6.1f}  {pid:>6}  {user[:14]:<14} {comm}")

report = "\n".join(lines) + "\n"
path = os.path.join(OUT_DIR, f"{started:%Y%m%d-%H%M%S}-{LABEL}.txt")
with open(path, "w") as f:
    f.write(report)
print(report)
print(f"saved: {path}")
