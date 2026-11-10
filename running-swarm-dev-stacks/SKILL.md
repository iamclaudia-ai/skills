---
name: running-swarm-dev-stacks
description: "MUST be used when starting, stopping, restarting or checking beehiiv's local dev stack (swarm API, client, orchid, Sidekiq workers), in the main checkout or a worktree, and when reading a service's output. Covers the `swarm` CLI from Michael's swarm-tools repo: one tmux session per instance (swarm-dev-N, ports 3000+N*100, app-N.localhiiv.com), api + client by default, orchid and workers on demand, `swarm logs` instead of pane numbers, `swarm status` memory, the workers guard (one shared Redis queue), why REDIS_URL must never be split per instance (Flipper flags live there), and stale-worktree symptoms. Triggers on: swarm start, swarm stop, swarm restart, swarm kill, swarm status, swarm logs, swarm api, start the dev server, start swarm, run the app locally, local dev stack, dev instance, instance number, worktree instance, app-1.localhiiv.com, swarm-dev, tmux pane, API pane, client pane, start workers, sidekiq locally, jobs not running, start orchid, orchid locally, PendingMigrationError, port 3000 in use, server.pid, parallel agents, parallel worktrees, dev stack memory."
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
