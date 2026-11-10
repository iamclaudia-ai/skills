---
name: diagnosing-udp-socket-leaks
description: "MUST be used when a Mac's network turns sluggish or jittery for no clear reason, when the UDP leak monitor texts an alert, or when net.inet.udp.pcbcount is high or climbing. Finds the gap between the kernel's UDP socket count and the sockets processes actually hold, samples short-lived socket churn to name the leaking process, proves a leak with a repro script, and covers the known cause (Rails/Datadog statsd to localhost:8125 with nothing listening, which macOS leaks over IPv6) and its fix (a statsd sink, run by swarm start). Triggers on: UDP leak, socket leak, udp pcbcount, pcbcount, leaked sockets, UDP leak monitor, monitor alert, network sluggish, ping jitter, kernel_task high CPU, dlil_input, orphaned sockets, statsd, dogstatsd, port 8125, ECONNREFUSED UDP, Chrome Helper UDP, cloudflared UDP, vesuvius slow network, too many UDP sockets."
---

# Diagnosing UDP Socket Leaks (macOS)

## When to Use

- The **vesuvius UDP leak monitor** texted (growth > 2000/h, or > 50K per boot).
- Ping to/from the Mac jitters (20-300 ms) while other machines on the LAN are fine, `kernel_task` burns CPU.
- `sysctl net.inet.udp.pcbcount` is in the thousands or more and climbing.

## Why it hurts

Every inbound multicast/broadcast packet (mDNS, SSDP: Echos, Chromecasts, Ring...) makes the kernel walk
**every** UDP PCB. At 192K leaked PCBs (Nov 2026) vesuvius showed `dlil_input_en0/en7` and `SOFLOW_GC` hot in a
kernel spindump and ping jitter on loopback. Leaked PCBs **never drain: only a reboot clears them.**

## Instructions

1. **Census:** `python3 -I $SKILL_DIR/scripts/udp-census.py 20`
   (skill dir: `~/.claude/skills/diagnosing-udp-socket-leaks`).
   - `orphaned` ≫ `held` means the PCBs belong to no open fd: a kernel leak. The **top holders list does not
     name the culprit** (Chrome Helper's ~100 QUIC sockets and cloudflared's 4 are normal and steady).
   - The churn section lists sockets that appeared/vanished in the window. A process reopening sockets to the
     same destination every second or two is the suspect, especially to an IPv6 address.
2. **Time it:** the monitor log (`anima/tmp/vesuvius-perf/udp-monitor.jsonl`, one row per 10 min with
   `udp`, `ruby` process count, `orbstack`, `swarm_tmux` sessions) shows when growth started. Match the start
   to what came up then (in Nov 2026: the exact minute `swarm-dev` started).
3. **Prove it:** `python3 -I $SKILL_DIR/scripts/udp-leak-repro.py <4|6> <host> <port> 500 recv`
   opens, connects, sends twice, closes 500 times and prints the pcbcount delta. `delta ≈ 500` = 1:1 leak,
   ±20 is background noise. Always run the control pair: same port over IPv4, and IPv6 with a listener bound.
   Each run of a leaking case adds ~500 permanent PCBs, so keep N small.
4. `netstat -an -p udp` printed nothing on macOS 27 (and through tokf); use lsof.

## Known cause: IPv6 + refused + close (Nov 2026)

- macOS leaks the PCB of a **connected IPv6 UDP socket closed after ECONNREFUSED** (ICMPv6 port unreachable).
  IPv4 doesn't leak. Measured: `::1:8125` refused +519/500; `127.0.0.1:8125` +4; `::1` with a listener +10.
- Trigger: beehiiv swarm's Rails (puma + sidekiq, ~100 ruby procs) send Datadog statsd to `localhost:8125`
  → `[::1]:8125`. Nothing listened, so every send was refused and dogstatsd-ruby reopened its socket:
  ~1.8K leaked PCBs/hour per swarm instance. Swarm's other UDP churn (127.0.0.1:3000-5800) is IPv4 and harmless.
- **Fix:** a sink that binds `[::1]:8125` + `127.0.0.1:8125` and drops packets. `swarm start` runs
  `ensure_statsd_sink` (in Michael's swarm tooling script; `swarm _statsd-sink` starts it alone). It's skipped if
  lsof shows a UDP listener on 8125, survives the tmux sessions, logs to `~/Library/Logs/swarm-statsd-sink.log`.
  After: +7 in 2.5 min vs ~+150 before.
- Any other app sending UDP to an unbound `localhost` port will leak the same way. The general fix is the same:
  give it a listener, or point it at `127.0.0.1`.

## Notes

- Details, numbers and history: `anima/tmp/vesuvius-perf/NOTES.md` (sections "Root cause", "ROOT CAUSE FOUND").
- Monitor: scheduler task "vesuvius UDP leak monitor" → `anima/tmp/scripts/udp-leak-monitor.py`.
- `lsof` only sees the current user's processes; a root daemon (e.g. a real Datadog agent) needs `sudo lsof`.
