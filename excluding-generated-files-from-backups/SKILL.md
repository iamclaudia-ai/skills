---
name: excluding-generated-files-from-backups
description: "MUST be used when excluding files or folders from Time Machine or Backblaze, or when a backup is slow, huge, or keeps running. Excludes regenerable folders (node_modules, .git, venv, __pycache__, .next, .turbo, gitignored dist/build/coverage, Xcode DerivedData, OrbStack VM disk) by name: Time Machine via fast sticky xattr exclusions (rerun daily by the Anima scheduler), Backblaze via name rules in bzinfo.xml. Covers checking what is excluded, verifying Backblaze honors its rules, and why backupd burns CPU. Triggers on: time machine exclusion, exclude from backup, tmutil addexclusion, backupd high CPU, time machine slow, backup taking forever, backblaze exclude, bzinfo.xml, excludefname_rule, exclude node_modules from backup, exclude .git, backblaze file count, asimov, backup generated files, sticky exclusion, com_apple_backup_excludeItem."
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

- **`exclude-from-time-machine`** `[--dry-run] [ROOT...]` (default root `~/Projects`): finds the
  folders and marks the new ones. Always-regenerable names are excluded anywhere; generic names
  (`dist build out coverage target`) only where `git check-ignore` says git ignores them. Also
  excludes `~/Library/Developer`. ~75 s on vesuvius, idempotent.

**One-time, by hand on a new machine:** OrbStack's VM disk (a 2 TB sparse `data.img.raw`,
rewritten constantly while OrbStack runs):
`tmutil addexclusion ~/Library/Group\ Containers/HUAQ24HBR6.dev.orbstack` (done on vesuvius
2026-11-09). App Group Containers are privacy-protected per process, so the Anima scheduler can
neither read nor write its xattr, and `tmutil isexcluded` from there doesn't see it either.
- **`exclude-from-backblaze`** `[--dry-run]`: adds missing name rules to Backblaze's `bzinfo.xml`
  (backs it up first). Always-regenerable names only.

```bash
anima skills run excluding-generated-files-from-backups exclude-from-time-machine --dry-run
anima skills run excluding-generated-files-from-backups exclude-from-backblaze
```

To add a name, add it to the lists in BOTH scripts, then run both.

## Scheduled

Anima scheduler task "Exclude generated folders from Time Machine" (cron `17 4 * * *`, exec) reruns
the Time Machine script daily: a folder that is deleted and recreated (`rm -rf node_modules`) loses
its mark. Backblaze rules are patterns, so they need no rerun.

## Checking

```bash
tmutil isexcluded <path>                               # [Excluded] / [Included]
tmutil status                                          # running backup: files/bytes/TimeRemaining
grep -c '/node_modules/' /Library/Backblaze.bzpkg/bzdata/bzfilelists/*_root_filelist.dat
cat /Library/Backblaze.bzpkg/bzdata/bzfilelists/filestats.xml   # everythingnum = files selected
```

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
- Excluding `.git` means local-only branches, stashes and unpushed commits aren't backed up
  (working trees still are). Michael chose that (2026-11-09).
- Postgres data (`docker-swarm/docker-volumes`) stays in Time Machine on purpose: TM copies from an
  APFS snapshot, so the copy is crash-consistent. `docker-swarm/scripts/backup` is the clean dump.
- Spotlight exclusions (System Settings → Spotlight → Search Privacy) are separate and root-only to
  script; verify one with `mdfind -count -onlyin <dir> 'kMDItemContentTypeTree == "public.item"'`
  (0 = excluded; check a control folder, since a bad query also returns 0).
