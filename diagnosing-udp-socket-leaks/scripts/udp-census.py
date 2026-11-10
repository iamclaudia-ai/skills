#!/usr/bin/env python3 -I
"""Where are this Mac's UDP sockets? Kernel count vs sockets processes hold, plus churn.

Usage: udp-census.py [SECONDS]   (default 20; 0 skips the churn sample)

1. net.inet.udp.pcbcount (every UDP PCB in the kernel) vs the UDP sockets lsof
   sees open in processes. A big gap = orphaned in-kernel PCBs: a kernel leak
   that no process "holds", so the top-holders list will NOT name the culprit.
2. Top holders (normal open sockets, e.g. Chrome's QUIC, for context only).
3. Churn: samples connected UDP sockets once a second for SECONDS and lists
   short-lived ones by process + destination. Leakers live here: something
   opening and closing a socket every second or two.
"""
import subprocess
import sys
import time
from collections import Counter


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout


def pcbcount() -> int:
    return int(run(["/usr/sbin/sysctl", "-n", "net.inet.udp.pcbcount"]).strip())


def udp_rows() -> list[tuple[str, str, str]]:
    """(command, pid, name) per open UDP socket visible to this user."""
    rows = []
    for line in run(["/usr/sbin/lsof", "+c", "0", "-n", "-P", "-iUDP"]).splitlines()[1:]:
        f = line.split()
        if len(f) >= 9:
            rows.append((f[0].replace("\\x20", " "), f[1], f[8]))
    return rows


seconds = int(sys.argv[1]) if len(sys.argv) > 1 else 20
kernel, rows = pcbcount(), udp_rows()
print(f"kernel UDP PCBs: {kernel}   held by processes (lsof): {len(rows)}   orphaned: {kernel - len(rows)}")
print("(lsof only sees this user's processes; run with sudo to include root daemons)\n")

print("top holders (normal open sockets, not necessarily leakers):")
for (cmd, pid), n in Counter((c, p) for c, p, _ in rows).most_common(8):
    print(f"  {n:5d}  {cmd} ({pid})")

if seconds <= 0:
    sys.exit(0)

print(f"\nsampling connected UDP sockets for {seconds}s...")
start, seen = pcbcount(), Counter()
for _ in range(seconds):
    for cmd, pid, name in udp_rows():
        if "->" in name:
            seen[(cmd, pid, name)] += 1
    time.sleep(1)
end = pcbcount()

short = Counter()
for (cmd, _pid, name), n in seen.items():
    if n < seconds:  # appeared or vanished during the window
        short[(cmd, name.split("->")[1])] += 1
print(f"pcbcount {start} -> {end} ({end - start:+d} in ~{seconds}s)")
print("short-lived sockets by process -> destination (IPv6 + refused = suspect):")
for (cmd, dest), n in short.most_common(15):
    print(f"  {n:5d}  {cmd} -> {dest}")
if not short:
    print("  none")
