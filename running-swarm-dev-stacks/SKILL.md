---
name: running-swarm-dev-stacks
description: "MUST be used when starting, stopping, restarting or checking beehiiv's local dev stack (swarm API, client, orchid, Sidekiq workers), in the main checkout or a worktree, and when reading a service's output. Covers the `swarm` CLI from Michael's swarm-tools repo: one tmux session per instance (swarm-dev-N, ports 3000+N*100, app-N.localhiiv.com), api + client by default, orchid and workers on demand, `swarm logs` instead of pane numbers, `swarm status` memory, the workers guard (one shared Redis queue), why REDIS_URL must never be split per instance (Flipper flags live there), and stale-worktree symptoms. Triggers on: swarm start, swarm stop, swarm restart, swarm kill, swarm status, swarm logs, swarm api, start the dev server, start swarm, run the app locally, local dev stack, dev instance, instance number, worktree instance, app-1.localhiiv.com, swarm-dev, tmux pane, API pane, client pane, start workers, sidekiq locally, jobs not running, start orchid, orchid locally, test an orchid PR, review an orchid change, publication site locally, localhiiv.com refused to connect, PendingMigrationError, port 3000 in use, server.pid, parallel agents, parallel worktrees, dev stack memory, reset apiary, apiary tear down, clickhouse reset, peerdb setup, setup_apiary, clickhouse system tables, trace_log, replication slot, ghcr denied, floci uploads lost."
---

# Running swarm dev stacks

`swarm` (in `~/Projects/beehiiv/swarm-tools/bin`, on PATH) runs beehiiv's dev stack in tmux.
Every instance works the same way, and agents in parallel worktrees each run their own.

## When to Use

- Starting the app to see a change work, in the main checkout or a worktree
- Adding or stopping orchid or Sidekiq workers on a running instance
- Reading a service's output (Rails errors, Vite errors, job logs)
- An instance misbehaving: port in use, stale `server.pid`, jobs never running, memory creep

## Instances

| | Instance 0 | Instance N > 0 |
|---|---|---|
| Checkout | main (`~/Projects/beehiiv/swarm`) | the current checkout (a worktree), or `--dir` |
| Session | `swarm-dev-0` | `swarm-dev-N` |
| App | http://app.localhiiv.com:3001 | http://app-N.localhiiv.com:(3001+N*100) |
| Ports | api 3000, client 3001, orchid proxy 3002 (v1 3003, v2 3004, HMR 3005/3006) | same offsets from 3000+N*100 |

All instances share one Postgres and one Redis, so publications and users are the same everywhere.
Need a special publication? Create it from your instance; everyone else sees it too.

## Commands

```bash
swarm start 4                    # api + client from the current worktree
swarm start 4 workers orchid     # on a running instance: adds those panes
swarm stop 4 workers             # stops it and closes the pane (no service: whole instance)
swarm restart 4 api              # or: all
swarm kill 4
swarm status                     # every instance, per-service MB, Sidekiq processes and their checkouts
swarm logs 4 api --lines 300     # a service's recent output
swarm api 4 /api/v1/orchid/sites/test-v2   # curl the API with the orchid Basic auth from Doppler
swarm help
```

Flags: `--force` (start: recreate; workers: skip the guard), `--no-mock`, `--https` (instance 0 only,
Caddy at https://app.localhiiv.com), `--search` (Elasticsearch), `--base PORT`, `--dir PATH`.
From an agent's Bash tool, `start` never attaches (no TTY, `$TMUX` set); it prints the attach command.

## Services

- **api, client**: always started. That's 90% of the work.
- **orchid**: proxy + v1 + v2 in one pane. Browse publications at `<pub>.localhiiv.com:<base+2>`.
  It is NOT started by default, so testing or reviewing anything under `apps/orchid-*` (publication
  sites) needs `swarm start N orchid` (or `--orchid`); without it, publication URLs refuse to connect.
- **workers**: ONE Sidekiq process for every queue (~0.5 GB). The queue list is built from
  `config/sidekiq/*.yml` at launch, so it never misses a queue.
- **workers-full**: `Procfile.dev`'s process-per-queue fleet (~8 GB idle). Almost never needed.

Start workers only when the change needs a job to actually run: `deliver_later` email (lands in
sendtrap), the AI agent/copilot, imports/exports, segments, post sends, RSS, podcasts, search
reindexing. Policies, UI and specs don't need them, and rspec never does. Jobs enqueued with no
worker running wait in Redis and run whenever any worker starts, on that worker's code.

## Finding output: by service, never by pane number

Panes always sit in the order api, client, orchid, workers, with only the running ones present, so
pane indexes shift. Each pane carries a `@swarm_service` tag and shows its name in the border.
Use `swarm logs N <service>`, or for raw tmux:
`tmux list-panes -t swarm-dev-N:0 -F '#{pane_id} #{@swarm_service}'`.

## The workers guard, and why Redis stays shared

Every instance uses `REDIS_URL=redis://localhost:6379/0`, so all Sidekiq processes pull from the
same queues: one worktree's job can run on another worktree's workers, with that checkout's code.
`swarm start N workers` therefore refuses while Sidekiq runs from another checkout, and names it.
Stop those (`swarm stop M workers`) or pass `--force` knowingly.

**Never point an instance at its own `REDIS_URL`.** It also backs Flipper (the Redis adapter is the
source of truth for every feature flag), `RedisStore::Store` and the money gem. A separate
`REDIS_URL` means an empty flag set: flag-on testing silently runs flag-off. Real per-instance
queues need BEE-28500 (`SIDEKIQ_REDIS_URL`) plus swarm-tools#5. Dev Redis DBs in use: 0 (app and
cache), 1 (cable), 2 and 4 (other apps), 10/11/14 (rspec).

## A stale worktree looks like a code bug

Run `bin/update` in a worktree before `swarm start N` whenever main has moved. Symptoms of skipping it:
`PendingMigrationError` on every request, orchid `ERR_MODULE_NOT_FOUND` (e.g. `http-proxy-3`) or Zod
env errors, pnpm installing ~1000 packages mid-launch, `lint:ts` TS6305 floods. (swarm-tools#2 will
check this before booting.)

## What `swarm` handles for you

- **Shared Docker** (Postgres, Redis, sendtrap, the repo's `docker` compose stack) always comes up
  from **main's** compose file. An old worktree's compose once re-created the retired rustfs
  container and hung every later start.
- **statsd sink** on UDP 8125: Rails sends Datadog metrics there, and with nothing listening macOS
  leaks an IPv6 socket per refused send (~1.8K/hour per instance, until a reboot). See
  `diagnosing-udp-socket-leaks`.
- **Stale `tmp/pids/server.pid`**: stops a leftover puma from the same checkout; leaves one live on
  another port alone (two instances can't share a checkout).
- **Ports**: frees only listeners. Never kill a port with plain `lsof -t -i tcp:PORT`, which also
  matches the browser connected to it.

## Shared Postgres: a named volume, not a bind mount

Since 10 Nov 2026 the data lives in the volume `docker-swarm_postgres17-data` (beehiiv/docker-swarm#1),
not `docker-volumes/postgresql`. On the bind mount every file op went through OrbStack's virtiofs:
each start re-chowned ~67k files (25–57 min), and after a night of lanes TRUNCATE-ing `swarm_test`
(~57k relation files) crash recovery ran for hours. On the volume, the same WAL replay took 1.9 s, and
a restart is ~30 s (Docker cycling the container plus an 11 s entrypoint ownership walk).

- `stop_grace_period: 2m` lets it shut down cleanly; a clean stop skips recovery entirely.
- **Copying a data dir into a volume:** don't `cp -a` from a bind mount inside a container. It
  managed ~1.5 files/s. Let macOS read the files and stream one tar into the VM, which took 49 s for
  1.9 GB / 67k files: `COPYFILE_DISABLE=1 tar --create --directory=<dir> --file=- . | docker run --rm -i
  … -v <volume>:/to <image> -c 'tar --extract --file=- --directory=/to --warning=no-unknown-keyword
  && chown -R postgres:postgres /to && chmod 700 /to'`. `COPYFILE_DISABLE=1` keeps `._*` files out;
  `chmod 700` matters, since Postgres refuses a data dir others can read. Put the pipeline in a script
  file (dcg trips on it inline, see `deleting-docker-resources`).
- **Nothing in a Docker volume is backed up.** The whole VM is one sparse image
  (`~/Library/Group Containers/HUAQ24HBR6.dev.orbstack/data/data.img.raw`), which OrbStack keeps out of
  Time Machine (`orb config show`: `data_allow_backup: false`) and Backblaze skips (`bzinfo.xml`). Postgres
  is covered by the Anima scheduler job "docker-swarm Postgres nightly dump" (3 AM), which runs
  `scripts/backup-rotate` into `docker-swarm/backups/` (keeps 7). Check its history if dumps look stale.
  Uploads in Floci (local S3, `docker_floci_data`, ~14 GB, mostly podcast audio) are covered by
  "docker-swarm Floci uploads backup" (3:15 AM), `scripts/backup-floci` → `backups/floci/` (incremental
  `aws s3 sync`, never deletes, ~75 s when nothing is new).
- **Specs upload into the dev bucket.** Test and dev share Floci's `beehiiv-development`, so fixture
  images pile up: 52K spec publications × 3 `*pixel.png` copies in five days, against a few hundred
  real uploads (BEE-28529). A huge object count in the dev bucket is that, not real data.
- A dump/restore isn't the shortcut it looks like: it needs Postgres running on the old storage
  first, and it drops the PeerDB replication slots.

## Resetting Apiary (ClickHouse + PeerDB) without losing uploads

**Never run swarm's `rake peerdb:apiary_tear_down`.** It is `docker compose down -v` on swarm's
whole compose project (`docker`), which deletes `docker_floci_data` (every local upload) too. Use
docker-swarm's `scripts/reset-apiary` (beehiiv/docker-swarm#3): it removes only ClickHouse, PeerDB
and Temporal and their volumes (`clickhouse-data`, `clickhouse-logs`, PeerDB catalog `pgdata`,
clickhouse-test's anonymous volume), keeps Floci and minio, stops on any volume it hasn't
classified, then runs `peerdb:setup_apiary` and swarm's `scripts/update_apiary` (the migration
wait). Michael runs it in his terminal: it prompts, and AWS SSO may open the browser.

- **Replication slots are handled by the image**: its `validate-postgres.sh` drops an inactive
  `peerflow_slot_<mirror>` whose mirror no longer exists, right before recreating the mirror (logs
  say `Dropped orphaned replication slot`). The new slots show `active: false` until the initial
  snapshot ends (a few minutes), then go active.
- **Bundler on the wrong Ruby**: a shell with `mise activate` keeps the Ruby it resolved in the
  caller's directory, so a script that `cd`s into swarm runs Ruby 4.x against a 3.4 Gemfile and
  dies after the teardown. Run swarm Ruby from scripts through `mise exec --`.
- **`denied: denied` pulling public `ghcr.io/peerdb-io/*`** = a stale ghcr.io login in the
  keychain (Michael's was username `USERNAME` with a dead `ghp_` token, GitHub API 401). Docker
  sends it and never falls back to anonymous; an empty `DOCKER_CONFIG` doesn't help, because the
  CLI auto-detects osxkeychain. Prove it with curl and an anonymous token
  (`https://ghcr.io/token?scope=repository:<repo>:pull`), then `docker logout ghcr.io`.
- **Measuring ClickHouse self-logging**: per-table size from `system.parts` (`database='system'
  AND active`; without `active` you count merged-away parts still on disk and see a fake spike),
  rows per window from each `*_log`'s `event_time`, and exact container disk rates from
  `/sys/fs/cgroup/io.stat` inside the container sampled 60 s apart (`docker stats` BlockIO is
  whole GB). Before Agus's 2026-11-12 image: 6.5 GiB of system tables per container in 22 h,
  ~33,500 rows/min idle, ~15 % CPU. After: ~1.2 MiB, a few hundred rows/min, ~6 %. Notes in
  `docker-swarm/tmp/apiary-reset/NOTES.md`.

## Don't

- Run `pnpm dev:workers` (the 8 GB fleet) or `dev:api`/`dev:client` by hand next to an instance.
- Start two instances from the same checkout (Rails refuses on the shared pidfile).
- Leave instances running when your session ends: `swarm kill N`. `swarm status` shows the memory.

## Notes

- Repo: github.com/kiliman/swarm-tools (private). Issues labelled `parallel-agents` track the
  roadmap: worktree audit (#1), preflight (#2), automatic instance numbers (#3), idle reaping (#4),
  per-instance Redis (#5).
- Sessions started by the old `swarm/tmp/swarm` have no service tags: `swarm kill N` works on them,
  restart doesn't. Recreate with `swarm start N --force`.
