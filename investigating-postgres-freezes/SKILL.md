---
name: investigating-postgres-freezes
description: "MUST be used when investigating beehiiv production Postgres stalls, freezes, or hangs: requests that time out with even BEGIN/COMMIT or primary-key reads taking seconds, many unrelated queries slow at the same instant, rack timeouts that cluster in time, or 'is the database freezing?'. Finds whole-server freezes from the primary's slow-statement log in Datadog (DDSQL freeze detector), confirms them from APM span gaps, tells a server freeze from row-lock pile-ups, and lists what is and isn't visible (Crunchy Bridge, PgBouncer, DBM gap, read-only replica). Triggers on: database stall, postgres freeze, db hang, primary froze, BEGIN slow, COMMIT slow, everything slow at once, timeouts cluster, rack timeout spike, pgbouncer waits, WAL stall, IO stall, crunchy bridge, slow statement log, freeze detector, lock pile-up, row lock wait, BEE-28687."
---

# Investigating Postgres Freezes (beehiiv production)

Built during BEE-28687 (Nov 12, 2026). Its findings comment is the worked example:
https://linear.app/beehiiv/issue/BEE-28687#comment-578204a5. Raw notes and queries:
`~/Projects/beehiiv/swarm/tmp/timeouts/NOTES-28687.md` and `tmp/timeouts/28687/`.

## When to Use

- Hard timeouts on unrelated endpoints line up in time, or a slow trace shows a trivial query (PK lookup,
  `BEGIN`, `COMMIT`, even `parse`) taking seconds.
- Someone asks whether the database is freezing, how often, or what's behind it.
- Before blaming one endpoint's query for timeouts: check that it isn't a victim of a database-wide freeze.

## The setup (as of Nov 2026)

- Prod Postgres is **Crunchy Bridge**, PG 17, ~27 TB. Cluster `zm23i3q62nhgnl3eputurm4odu`, primary host
  `ltzcbljcajavrkxpdnxmv6nfpa`, HA standby `zvqsj4xrz5dvnbntfvx76ay7da`. The read replica (`READONLY_DATABASE_URL`)
  cascades from the standby. The app goes through Crunchy's PgBouncer on 5431; direct 5432 is barely used.
- `synchronous_commit = local` (sync replication can't stall commits).
- **Visible:** the primary's slow-statement, error and DDL log lines in Datadog logs (`service:postgres
  host:ltzcbljcajavrkxpdnxmv6nfpa`, ~7 days retention); APM spans; the read-only replica (`pg_settings`,
  `pg_stat_user_tables`, `pg_stat_statements`); prod ClickHouse.
- **Not visible:** Datadog DBM / `postgresql.*` metrics (staging only, BEE-28691); checkpoint, autovacuum and
  lock-wait log lines (never forwarded); the provider's CPU/IOPS/memory graphs (Crunchy console only; Michael has
  no access; swarm's repo hook blocks the Crunchy CLI and **any command containing its two-letter name**).

## 1. Find freezes server-side (the detector)

A freeze shows up as many *unrelated* statements finishing in the same second with nearly equal durations:
they all started normally, all stopped, and all resumed together. Run with the Datadog MCP's
`analyze_datadog_logs` (DDSQL), filter `service:postgres host:ltzcbljcajavrkxpdnxmv6nfpa "LOG:  duration:"`:

```sql
SELECT DATE_TRUNC('second', timestamp) AS release_s, COUNT(*) AS stuck,
  COUNT(DISTINCT SUBSTRING(SPLIT_PART(SPLIT_PART(message, '*/ ', 2), ' WHERE', 1), 1, 50)) AS shapes,
  ROUND(MIN(CAST(SPLIT_PART(SPLIT_PART(message, 'LOG:  duration: ', 2), ' ', 1) AS DECIMAL))/1000, 1) AS min_s,
  ROUND(MAX(CAST(SPLIT_PART(SPLIT_PART(message, 'LOG:  duration: ', 2), ' ', 1) AS DECIMAL))/1000, 1) AS max_s
FROM logs
WHERE message LIKE '%LOG:  duration: %'
  AND CAST(SPLIT_PART(SPLIT_PART(message, 'LOG:  duration: ', 2), ' ', 1) AS DECIMAL) >= 4000
GROUP BY DATE_TRUNC('second', timestamp)
HAVING COUNT(DISTINCT SUBSTRING(SPLIT_PART(SPLIT_PART(message, '*/ ', 2), ' WHERE', 1), 1, 50)) >= 6
   AND APPROX_PERCENTILE(0.5) WITHIN GROUP (ORDER BY CAST(SPLIT_PART(SPLIT_PART(message, 'LOG:  duration: ', 2), ' ', 1) AS DECIMAL))
       - MIN(CAST(SPLIT_PART(SPLIT_PART(message, 'LOG:  duration: ', 2), ' ', 1) AS DECIMAL)) <= 1500
ORDER BY 1
```

`release_s` is when the freeze ended; it started roughly `min_s` earlier.

**Traps:**
- The phrase is `LOG:  duration:` with **two spaces**. Keep both the search filter and the `LIKE`: multi-line
  statement continuations contain "duration:" and break the `CAST`.
- Without `shapes >= 6`, a single query shape run in a burst (daily at 21:18, 11:32, 12:16 UTC) looks like a freeze.
- DDSQL has no `GREATEST`, no `->>`, and its regex is ICU.

## 2. Confirm from the app side

Aggregate spans as a 1-second timeseries on `operation_name:pg.async.exec` around a `release_s`: a real freeze
shows a **gap with no span starts** on the primary while the standby keeps logging. Spans for `BEGIN`/`COMMIT`
over 1 s in `service:swarm` give the client-side list.

## 3. Tell a freeze from a lock pile-up

- **Whole-server freeze:** unrelated reads, `BEGIN`, `COMMIT` and parses all wait the same time; the primary logs
  nothing during it. Causes live in Postgres or the host (I/O or WAL flush stall, a global LWLock, CPU/memory).
- **Row-lock pile-up:** the same UPDATE shape waits minutes and many release in one burst (e.g. `automation_journey_steps`
  updates from `Automations::FailJourneys`, BEE-28692). Reads don't wait on row locks, so this can't freeze reads by itself.
- Line freezes up against nightly crons (`config/schedule.yml`), deploys (Datadog deployment events), send bursts
  (ClickHouse), and replica `pg_stat_user_tables.last_autovacuum` before calling anything a cause.

## 4. Close the gap that blocks a verdict

The deciding evidence is the provider's host metrics (CPU, IOPS/disk throughput, memory, maintenance/backup events)
at the freeze windows. Ask whoever has Crunchy console access (Poage was asked Nov 12) for screenshots at the
exact minutes. Getting DBM reporting again (BEE-28691) would make the next investigation self-serve.
