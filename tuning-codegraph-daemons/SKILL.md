---
name: tuning-codegraph-daemons
description: "MUST be used when CodeGraph is heavy on disk, CPU or memory, when its daemons restart or catch up too often, when a git worktree needs a CodeGraph index (seed it, never `codegraph init` a big repo), and when cleaning up worktrees or their indexes. Covers how the `codegraph serve --mcp` daemon lives and dies (one per project root, idle timeout, the inactivity backstop, proxies that respawn it), the env knobs and what each costs, the catch-up reconcile that aborts under query-pool readers and redoes ~1 GB of writes (upstream #3273), reading daemon.log, APFS-clone seeding from an origin/main seed worktree, and swarm-tools' swarm-codegraph / swarm-worktree-sweep / swarm-nightly. Triggers on: codegraph slow, codegraph disk writes, codegraph daemon, codegraph serve, daemon.log, catch-up reconcile, WAL checkpoint cannot progress, WalValveAbortError, query pool, CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS, inactivity backstop, codegraph worktree, seed codegraph index, codegraph init worktree, codegraph clone, prune codegraph indexes, .codegraph size, worktree cleanup, sweep worktrees, swarm-codegraph, swarm-worktree-sweep, high disk IO."
---

# Tuning CodeGraph Daemons

How the CodeGraph MCP daemon behaves on a multi-worktree machine, the settings that keep it
cheap, and the tools that seed and prune per-worktree indexes. Measured on vesuvius with
beehiiv/swarm (44,632 files, ~1.5 GB index) in Nov 2026, CodeGraph v1.6.2.

## How the daemon lives

- **One daemon per project root**, by design: its own socket, SQLite writer lock and file watcher.
  Sessions in the same root share it through a small per-session proxy (`codegraph serve --mcp`
  with no `--path`). The daemon itself shows as `serve --mcp --path <root>`.
- The **proxy outlives the daemon**. When the daemon exits, the next tool call spawns a new one
  (or serves in-process and retries after 5 s, doubling to 5 min). CodeGraph never goes away; a
  restart costs a **catch-up reconcile** of everything that changed while it was down.
- A daemon can open other roots via `projectPath` (LRU of 8, released after 10 min idle), but it
  takes that root's writer lock, and a forgotten `projectPath` answers from the wrong checkout.
  It is not a "one daemon for every worktree" (that needs upstream work; see the codegraph-hub fork,
  upstream #3211).
- The daemon is spawned with the proxy's environment, so `env` in the MCP config reaches it.
  Running daemons keep their env until they exit.

## Settings (codegraph entry `env` in `~/.claude.json`)

| Var | Ours | Default | Why |
|---|---|---|---|
| `CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS` | 3600000 | 300000 | Linger 1 h after the last session leaves, so a returning session skips the catch-up |
| `CODEGRAPH_DAEMON_MAX_IDLE_MS` | 0 | 1800000 | Inactivity backstop off (see below) |
| `CODEGRAPH_QUERY_POOL_SIZE` | 2 | cores - 1 | 15 workers per daemon was most of its ~2 GB RSS, and their reads pin the WAL |
| `CODEGRAPH_CATCHUP_GATE_TIMEOUT_MS` | 0 | 3000 | First tool call waits for the catch-up instead of reading beside it |

Change it with `claude mcp remove codegraph -s user` + `claude mcp add-json -s user codegraph '{…}'`
(keep `"alwaysLoad": true`). Confirm on the next daemon start: its `daemon.log` line says
`Idle timeout 3600000ms` and `Query pool: up to 2 worker thread(s)`.

**The backstop** fires after 30 min with no queries, and only exits when no connected client can
be proven alive by pid. It exists for Windows named pipes whose close never arrives. On macOS a
dead process's socket always closes, and a separate pid sweep drops dead clients, so it guards
nothing and only kills quiet-but-alive sessions (we saw `inactivity backstop; clients=1`).

## The catch-up abort (upstream colbymchenry/codegraph#3273)

```text
Catch-up reconcile still running after 3000ms; serving this tool call now … (#905)
Catch-up sync failed …: WAL checkpoint cannot progress while a reader pins frames (wal=1280MB, …)
```

With the default 3 s gate, a tool call reads through the query pool while the reconcile writes;
the reader pins the WAL, the valve (#1751, the fix for a 64 GiB WAL in #1539) fails closed, and
the next tool call retries the reconcile **from scratch** (it isn't left stale, but ~1.3 GB of
writes are thrown away and redone; at 112 MB/s). Gate 0 plus a small pool avoids it.

Slow 1-2 file auto-syncs (2-36 s) cluster in the first minutes after a daemon start, most likely
contending with the background catch-up. A real restack is inherent work either way
(`Auto-synced 222 file(s) in 21493ms`).

## Diagnosing

- `<root>/.codegraph/daemon.log`: start lines (with the idle timeout), catch-up results, every
  auto-sync with its file count and duration, shutdown reasons.
- `daemon.pid` (JSON, `.pid`) and `writer.pid` (`mode`, `ready`) in the same folder.
- Per-process disk I/O: `diskio.swift` in the `excluding-generated-files-from-backups` skill
  (`proc_pid_rusage`). `ps -axo pid,etime,%cpu,rss,command | grep "codegraph.*serve"` for the rest.
- `codegraph status` shows sizes and WAL size, **not** staleness; `codegraph sync` has no dry run.

## Worktree indexes: seed, never init

Each worktree needs its own index (reads must match its checkout). For a big repo, `codegraph init`
takes minutes and writes the whole index. Instead, clone one:

- SQLite page size (4 KB) = APFS block size, `auto_vacuum=0`, and CodeGraph's only `VACUUM` is in an
  uncalled `optimize()`. So `cp -c` (clonefile) of a quiescent db costs ~0 bytes, and the clone
  diverges only in the pages a checkpoint rewrites. `du` counts clones in full: measure with `df`.
- Clone a **consistent single file**: `sqlite3 src.db ".backup 'dst.db'"` from a live db, or a db
  no process has open after `PRAGMA wal_checkpoint(TRUNCATE)`. Never copy a live db and its `-wal`
  separately.
- Seed from an index of **origin/main**, not the main checkout: ours was 305 commits behind (only
  as current as its last `git pull`), and the first seed re-indexed 1,960 files (2 min, 459 MB
  diverged). From a current seed: 8.8 s, "Already up to date".
- An index that appears after a session started is picked up on the next tool call (the engine
  re-resolves its project per call), so seeding in the background at session start works.

## swarm-tools (beehiiv/swarm)

All in `~/Projects/beehiiv/swarm-tools/bin` (kiliman/swarm-tools, issue #7, PR #10):

| Command | Does |
|---|---|
| `swarm-codegraph status` | Index size, idle days, daemon running, per worktree; seed age |
| `swarm-codegraph seed <wt> [--force]` | Clone the seed into a worktree, then `codegraph sync` |
| `swarm-codegraph refresh-seed [--force]` | Move `swarm.worktrees/.codegraph-seed` to origin/main and sync it (locked) |
| `swarm-codegraph prune [--days 7] [--apply]` | Delete `.codegraph/` of worktrees idle N days with nothing running |
| `swarm-codegraph ensure [dir]` | SessionStart hook (`~/.claude/settings.json`): background-seed an index-less swarm worktree |
| `swarm-worktree-sweep [--apply]` | Remove worktrees whose PR merged (HEAD at/behind PR head, idle 1 d) and idle review checkouts |
| `swarm-nightly [--apply-sweep]` | Anima scheduler task "swarm nightly cleanup" at 03:45; log in `~/Library/Logs/swarm-tools/` |

## Traps

- **"Unpushed" lies after a squash merge**: GitHub deletes the head branch, so merged commits are
  on no remote ref. Compare HEAD with the PR's `headRefOid` instead.
- **"Last used" lies**: `git status` rewrites the worktree's git index (mtime = now; use
  `git --no-optional-locks`), and `git gc` rewrites every worktree's `logs/HEAD` without adding
  entries. Read the timestamp inside the last reflog line; worktrees without a reflog fall back to
  `HEAD`'s mtime.
- A worktree's `tmp/` notes are git-ignored and `git worktree remove` deletes them silently: remove
  through `tidy-worktrees.sh` (deleting-local-branches skill), which archives them as clones and
  skips Rails' regenerable `tmp/cache` (~75 MB of bootsnap per swarm worktree).
- dcg blocks `sqlite3` with shell variables inside a heredoc (`database.sqlite:stdin-unverified`),
  and `rm -rf` outside `/tmp` (move to `~/.Trash/` instead). Edit scripts that contain `sqlite3` or
  `cp` calls with the Edit/Write tools, not python-in-a-heredoc: dcg parses the heredoc text.
- The Anima scheduler keeps only the first 4 KB of a task's output: log to a file, print a summary.
