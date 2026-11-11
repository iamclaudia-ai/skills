---
name: excluding-generated-files-from-backups
description: "MUST be used when excluding files or folders from Time Machine or Backblaze, or when a backup is slow, huge, or keeps running. Excludes regenerable folders (node_modules, .git, venv, __pycache__, .next, .turbo, gitignored dist/build/coverage, Xcode DerivedData, OrbStack VM disk) by name: Time Machine via fast sticky xattr exclusions (an FSEvents watcher marks new folders instantly; a daily sweep backs it up), Backblaze via name rules in bzinfo.xml. Covers checking what is excluded, verifying Backblaze honors its rules, why backupd burns CPU, and measuring a quiet-system baseline with backups and Spotlight off. Triggers on: baseline, system baseline, quiet baseline, pause backblaze, stop spotlight indexing, mdutil, bztransmit high CPU, Mac feels slow, disk activity, time machine exclusion, exclude from backup, tmutil addexclusion, backupd high CPU, time machine slow, backup taking forever, backblaze exclude, bzinfo.xml, excludefname_rule, exclude node_modules from backup, exclude .git, backblaze file count, delete files from backblaze, backblaze version history, fswatch, watch for new folders, asimov, backup generated files, sticky exclusion, com_apple_backup_excludeItem."
---

# Excluding Generated Files from Backups

Neither Time Machine nor Backblaze excludes by folder name out of the box. Generated folders under
`~/Projects` (node_modules alone was 13.4M of Backblaze's 25.8M files on vesuvius) make every backup
slow: `backupd` ran at 1-1.4 cores for 14+ hours walking 23M files.

## When to Use

- A backup is slow, huge, or `backupd` / `bztransmit` is high in `top`
- Adding a new kind of generated folder to the exclusions
- Checking whether a path is backed up

## Available Commands

- **`exclude-from-time-machine`** `[--dry-run] [ROOT...]` (default root `~/Projects`): sweeps for
  the folders and marks the new ones. Always-regenerable names are excluded anywhere; generic names
  (`dist build out coverage target`) only where `git check-ignore` says git ignores them. Also
  excludes `~/Library/Developer`. ~75 s on vesuvius, idempotent.
- **`watch-generated-folders`** `[ROOT...]`: marks folders the moment they're created (FSEvents via
  `fswatch`), so an hourly backup never catches a fresh `pnpm install` in a new worktree. Runs under
  launchd; don't start it by hand.
- **`install-watcher`** `[--remove]`: writes and loads the launchd agent
  `ai.iamclaudia.exclude-generated-watcher` (KeepAlive, low priority). Needs `brew install fswatch`.
  Log: `~/Library/Logs/exclude-generated-watcher.log`.
- **`exclude-from-backblaze`** `[--dry-run]`: adds missing name rules to Backblaze's `bzinfo.xml`
  (backs it up first). Always-regenerable names only.

```bash
anima skills run excluding-generated-files-from-backups exclude-from-time-machine --dry-run
anima skills run excluding-generated-files-from-backups install-watcher
anima skills run excluding-generated-files-from-backups exclude-from-backblaze
```

The name lists live in `scripts/generated-names.sh` (both Time Machine scripts source it) and in
`NAMES` in `exclude-from-backblaze.py`: change both, then rerun the sweep and the Backblaze script.

**One-time, by hand on a new machine:** OrbStack's VM disk (a 2 TB sparse `data.img.raw`,
rewritten constantly while OrbStack runs):
`tmutil addexclusion ~/Library/Group\ Containers/HUAQ24HBR6.dev.orbstack` (done on vesuvius
2026-11-09). App Group Containers are privacy-protected per process, so the Anima scheduler can
neither read nor write its xattr, and `tmutil isexcluded` from there doesn't see it either.

## Watcher + sweep

The watcher handles new folders; the Anima scheduler task "Exclude generated folders from Time
Machine" (cron `17 4 * * *`, exec) sweeps daily as a backstop: folders created while the watcher was
down, a `.git` from a clone made before install. Backblaze rules are patterns, so they need neither.

Measured on vesuvius: idle 0.0% CPU / 6.5 MB. A burst of 72K file events (6K folders) in 18.6 s cost
fswatch 3.7 CPU-seconds total; the new `node_modules` was marked within ~1 s. fswatch's `-i` regex
passes only paths ending in a watched name, and the handler skips ones inside an excluded folder.

## Checking

```bash
tmutil isexcluded <path>                               # [Excluded] / [Included]
tmutil status                                          # running backup: files/bytes/TimeRemaining
cat /Library/Backblaze.bzpkg/bzdata/bzfilelists/filestats.xml   # everythingnum = files selected
# Are excluded files still being UPLOADED? (column 4 is GMT: 10:48 EST = 15:48 GMT)
awk -F'\t' '$2=="+" && $4>="<yyyymmddHHMMSS GMT>" && $NF~/\/node_modules\//' \
  /Library/Backblaze.bzpkg/bzdata/bzbackup/bzdatacenter/bz_done_$(date -u +%Y%m%d)_0.dat | wc -l
```

`bzfilelists/*_root_filelist.dat` is what the scanner **saw**, not what's selected: it lists
60K `.log` files and OrbStack data that were excluded all along. Counting `node_modules` in it
proves nothing; verify rules against uploads in `bz_done`. A full rescan (`*_root_filelist.dat.future`
growing, `bzfilelist` running) holds uploads back until it finishes: on 2026-11-09 one ran from
Nov 6 to past noon Nov 9 (70M lines) after iCloud re-downloaded offloaded files, with 1 upload all day.

## Quiet baseline

To see what "normal" load is without backups and indexing (and spot anomalies against it):
`scripts/quiet.sh` (sudo: Spotlight indexing off, Backblaze unloaded and killed; turn TM's automatic
backups off in Settings or `sudo tmutil disable`), then `scripts/baseline.py 180 quiet <out-dir>`
(per-process CPU from `ps` cputime deltas, disk0 `iostat`, memory), then `scripts/restore.sh`.
Rerun `baseline.py` with another label when the Mac feels slow and compare. To see **which process**
drives disk I/O (iostat only gives totals; `fs_usage`/`iotop` need root):
`swiftc -O scripts/diskio.swift -o <out>/diskio && <out>/diskio 30` (per-process read/write MB/s via
`proc_pid_rusage`). Write it with the Write tool: dcg blocks a heredoc whose body contains `>`.

vesuvius, 2026-11-11, working (several swarm sessions, up a day): disk0 avg 4,539 tps / 66 MB/s
(~70x quiet), CPU 28% of 16 cores, 83% of 128 GB free, no swap. The disk was codegraph: a newly
started session's MCP daemon wrote 112 MB/s during its catch-up reconcile (1.2-1.7 GB index per worktree).

vesuvius, 2026-11-10, quiet after a reboot: disk0 avg 66 tps / 1.1 MB/s (max 219 / 2.75), CPU 227% of
one core (14% of 16): mds 45, WindowServer 32, mdsync 17, nsurlsessiond 12, cloudd 10. Before
quieting, Spotlight's post-reboot reindex alone was 3-6K tps / 35-120 MB/s.

- **Backblaze "Pause" doesn't stop `bztransmit`**: it sat at 100% of a core, no network, no user
  files open. `bztransmit`/`bzfilelist` are reparented to launchd, so unloading `bzserv` alone leaves
  them running; `quiet.sh` pkills them.
- **`mdutil -a -i off` stops Spotlight's disk I/O but not its CPU**: `mds`, `mdsync` and new
  `mdworker_shared` keep running (~70% of a core), and `/Volumes/Time Machine` stays enabled.
- **Spotlight and TM stay off across reboots** until `restore.sh`; Backblaze comes back on reboot.
- The Backblaze menu agent is in `~/Library/LaunchAgents`, not `/Library/LaunchAgents`.
  `launchctl bootstrap` on something already loaded fails with "5: Input/output error": harmless.
- `iostat` reprints its header every ~20 rows, and its first row is the since-boot average.

## Traps

- **`tmutil addexclusion` takes ~11 s per path while a backup runs** (it waits on backupd): 2,268
  folders would have taken ~7 h. The script writes the same xattr directly (~2 ms):
  `com.apple.metadata:com_apple_backup_excludeItem` = binary plist of `com.apple.backupd`.
  `tmutil isexcluded` reports those as `[Excluded]`.
- A backup already in progress keeps its file list; exclusions show from the next one.
- `tmutil addexclusion -p` (fixed path) needs root; the sticky form doesn't.
- Backblaze rules match the **lowercased** path; `contains_1="/name/"` matches the folder anywhere.
  `skipFirstCharThenStartsWith="users/michael/projects/"` would scope one to Projects. Applied at
  the next hourly file scan; Backblaze then drops excluded files from the backup after retention.
- **Backblaze can't delete specific files from a backup** (no CLI, no per-folder purge). Excluded
  files age out per the version-history setting. On Forever that's never, billed at $0.006/GB/month
  for versions older than one year. Shortening version history (web console → Overview → Version
  History) purges EVERYTHING past the new window, real deleted files included; deleting the whole
  backup is the only immediate removal. On vesuvius (2026-11-09) the file list held ~180 GB of
  node_modules + ~105 GB of other generated folders + ~8 GB .git: worst case ~$1.75/month once
  over a year old. Michael's call whether that's worth a purge.
- **What Backblaze has ever stored is logged locally**, not just what's selected now:
  `/Library/Backblaze.bzpkg/bzdata/bzbackup/bzdatacenter/bz_done_YYYYMMDD_0.dat` (135 files / 21 GB
  on vesuvius, from 2025-08), tab-separated, one line per upload/dedupe/delete event, path in the
  last column. Diff those paths against the disk to find what Backblaze still holds that the Mac
  lost; restore through the web console or Downloader app (no CLI for personal backups).
  `scripts/backblaze-missing-files.py <out-dir> [ROOT...]` does it (~2 min for 21 GB of logs):
  ops are `+` uploaded, `=` re-upload/chunk, `-` gone from the Mac. Photos originals show up as
  missing when iCloud Photos "Optimize Mac Storage" offloads them: match the UUID filename against
  `ZASSET.ZUUID` in `Photos.sqlite` (open `?mode=ro&immutable=1`) before calling a photo lost.
  `bzfilelists/*_root_filelist.dat` is only the current selection.
- fswatch prints flags then the path (`Created /path`); with `--event` filters there's no `IsDir`
  flag, so the handler tests `[ -d ]`. Renames report the new path.
- Excluding `.git` means local-only branches, stashes and unpushed commits aren't backed up
  (working trees still are). Michael chose that (2026-11-09).
- **VM disk images: excluded from both, by folder** (2026-11-10). Backblaze's file-type list skips
  `vmdk hdd vhdx vdi dmg sparseimage` but **not `.img` or `.qcow2`**: before the folder rules it had
  uploaded 80.6 GB of Claude Desktop's VM (12 GB on disk, re-sent as it changed), 24.7 GB of Android
  emulators and 6.2 GB of iOS simulators. Excluded now: OrbStack `…/HUAQ24HBR6.dev.orbstack` (TM by us
  and by OrbStack's `data_allow_backup: false`; Backblaze `…/data/`), `~/Library/Application
  Support/Claude/vm_bundles`, `~/.android/avd`, `~/Library/Developer` (TM) / its `CoreSimulator`
  (Backblaze). Backblaze rules are `<bzdirfilter dir="<lowercased path>/" whichfiles="none" />` lines
  in `do_backup`. To find new ones: `find ~ -type f -size +2G` for VM-ish extensions, then total
  uploads per folder from `bz_done` (column 13 is bytes; `rg` takes 3 s where `cat` timed out).
- **Data inside containers is in no backup**, so it's dumped out to files that are:
  `docker-swarm/scripts/backup-rotate` (Postgres) and `backup-floci` (uploads), nightly via the
  Anima scheduler. TM *did* hold crash-consistent copies of the old Postgres bind mount (it copies
  from an APFS snapshot); Backblaze's file-by-file copies weren't.
- Spotlight exclusions (System Settings → Spotlight → Search Privacy) are separate and root-only to
  script; verify one with `mdfind -count -onlyin <dir> 'kMDItemContentTypeTree == "public.item"'`
  (0 = excluded; check a control folder, since a bad query also returns 0).
