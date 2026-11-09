---
name: auditing-apps
description: "MUST be used for the monthly app audit of Michael's Mac, and whenever cleaning up what's installed: GUI apps (Homebrew casks, App Store, Setapp, hand-installed), login and background items, launchd daemons, Homebrew CLI tools, and regenerable disk caches. Covers the high-bar rule (challenge everything unused or that Claude can do herself), catalog-apps / scan-apps, Spotlight last-used dates, sfltool dumpbtm + btm-audit, CLI usage scoring from zsh history and Claude transcripts, safe removal (zap traps, trash-app.sh, daemon and audio-driver leftovers, Trash login items), making apps on-demand, the disk pass (uv, DeviceSupport, DerivedData, Docker build cache, pnpm/npm/bun/gradle) and the dcg rules for deleting under ~. Triggers on: app audit, monthly audit, audit apps, clean up apps, uninstall apps, remove app, what's installed, unused apps, app cleanup, Mac is sluggish, slow after upgrade, login items, background items, startup items, launch agents, launch daemons, sfltool, dumpbtm, CLI tools review, brew cleanup, unassigned apps, catalog-apps, scan-apps, free disk space, disk cleanup, clear caches, uv cache, DeviceSupport, DerivedData, Setapp apps, zap."
---

# Auditing Apps

A monthly pass over everything installed on Vesuvius: apps, login and background
items, CLI tools, and disk. First done 2026-11-08, after the macOS 27 upgrade left
the Mac sluggish (notes: `~/dotfiles/tmp/app-cleanup/NOTES.md`).

This is a **dotfiles project skill**. The inventory scripts live in `~/dotfiles/scripts`,
the layer Brewfiles in `~/dotfiles/setup/{baseline,personal,work}/Brewfile`.

## The high-bar rule (Michael's standing rule)

On every audit, **challenge** each app he hasn't used recently, and anything I can
do for him myself (run a Shortcut, record or convert audio and video with ffmpeg,
make a GIF, OCR, put files on his iPhone): "do you really need this?". He'd rather
have fewer apps and ask me. Keepers go into a layer Brewfile; everything else goes.
Explain what an unfamiliar app or tool does before asking: he often doesn't know.

Replaced already, don't reinstall:
- **Logi G Hub** (Yeti X noise reduction, Blue VO!CE): macOS **Voice Isolation** does it better.
  Control Center > Mic Mode, while an app is using the mic. It's set per app, once per app. Michael
  tested it in Voice Memos and FluidVoice on 2026-11-08 and the hiss went silent. Meeting apps without
  Mic Mode have their own noise suppression.
- **WALTR PRO**: I convert with ffmpeg and put the files on his iPhone.

## When to Use

- The monthly audit (a scheduler reminder fires on the 1st)
- Michael says the Mac is slow, or asks what's installed, running at login, or eating disk
- After removing apps, to catch leftovers

## Available Commands

Project skills aren't visible to the anima skills runner (it only looks in `~/.claude/skills`),
so run the scripts directly from the project link, `S=~/dotfiles/.claude/skills/auditing-apps/scripts`:

- **`btm-audit <dump>`**: parse `sudo sfltool dumpbtm` output; one line per login or
  background item: `FLAG|ON/off|type|name|path`, flagging `TRASH` (target is in the
  Trash, still launching) and `MISSING` (target gone).
- **`cli-usage [formula...] [--days N]`**: score Homebrew formulae by real use (zsh history
  + my Bash commands from Claude transcripts). No arguments = the `brew` lines of
  `setup/unassigned.txt`.
- **`perf-baseline.sh [label]`**: snapshot load, memory, top CPU/RAM, the background work
  that skews numbers (Time Machine, iCloud, Spotlight, media analysis), launchd counts, and the
  last 24h of diagnostic reports (`.hang` = the UI froze). Saves to `~/dotfiles/tmp/perf-baselines/`.
  Run it after a boot **once Time Machine and iCloud are quiet**, and compare it with earlier runs.
- **`trash-app "Name|bundle.id" [...] [--dry-run]`**: quit, boot out the jobs named after
  the bundle id, trash the app and its usual `~/Library` data, then print the cask's
  uninstall/zap paths for the extras.

```bash
sudo sfltool dumpbtm > /private/tmp/btm.txt
~/dotfiles/.claude/skills/auditing-apps/scripts/btm-audit.py /private/tmp/btm.txt
~/dotfiles/.claude/skills/auditing-apps/scripts/cli-usage.py
~/dotfiles/.claude/skills/auditing-apps/scripts/cli-usage.py mono watchman --days 30
~/dotfiles/.claude/skills/auditing-apps/scripts/trash-app.sh "Speedtest|com.ookla.speedtest-macos" --dry-run
```

## Instructions

Keep a `NOTES.md` under `~/dotfiles/tmp/app-audit-YYYY-MM/` as you go.

### 1. Inventory

```bash
~/dotfiles/scripts/catalog-apps   # writes Brewfile, applications.md, setup/unassigned.txt
```

- `setup/unassigned.txt`: everything installed that no layer Brewfile lists (brew, cask, mas,
  vscode, uv, cargo, go). VS Code extensions: Michael skips them (Settings Sync).
- `applications.md`: GUI apps by source (cask-managed, App Store, could-be-cask, manual,
  Setapp).
- Last-used dates (Spotlight; `(null)` = not opened from Finder/Dock since the last reindex,
  so it's a hint, not proof):

  ```bash
  for a in /Applications/*.app /Applications/Setapp/*.app; do
    printf '%s\t%s\n' "$(mdls -raw -name kMDItemLastUsedDate "$a")" "$(basename "$a" .app)"
  done | sort
  ```

### 2. Startup and background

- `sudo sfltool dumpbtm` + `btm-audit`: login items, agents, daemons. Every `TRASH` or `MISSING` row
  that's `ON` needs fixing.
- Running cost: `ps -axo rss,pcpu,comm -r` and look for helpers of apps he doesn't use.
- Keep (as of 2026-11): cloudflared (tunnel to vesuvius), caddy, anima watchdog, workspace-mcp,
  sidepulse, watchman, Setapp agents (licensing), Microsoft AutoUpdate, OneDrive FileProvider.

### 3. CLI tools

`cli-usage` for unassigned formulae. Real usage is mostly **me**, so the `me` column matters most.
Check `used-by` before removing a dependency. Kept on purpose: mono (Fuse Android builds), axe,
xcodegen, openjdk@17, watchman, imsg, resend, dnsimple, certbot, gogcli, azure-cli (fuse3 webapps).

### 4. Decide with Michael

One checklist: app, what it is, last used, my recommendation (with the high-bar challenge).
He answers REMOVE / KEEP (which profile) / ON-DEMAND. Browsers for testing go in **work**,
other keepers in **personal**.

### 5. Remove

| Source | How |
|---|---|
| Homebrew cask | `brew uninstall --zap --cask X`, except the zap traps below |
| Homebrew formula | `brew uninstall --force X` (Homebrew 7 removes only the newest version without `--force`), then `brew cleanup --prune=all` |
| App Store | `sudo mas uninstall <id>` (`mas list` for ids) |
| Setapp | quit, trash `/Applications/Setapp/X.app` (trash-app does it), disable its login helper |
| Hand-installed | `trash-app` (bundle id: `mdls -raw -name kMDItemCFBundleIdentifier X.app`), then the zap extras it prints |

**Zap traps** (plain uninstall, NO `--zap`):
- `chatgpt`: the cask is now the ChatGPT + Codex app; its zap trashes Codex dirs Cody shares.
- `docker-desktop`: its zap trashes `~/.docker`, which OrbStack uses.
- Gemini and other Google apps: keep Google Keystone/Updater, Chrome needs it.

**Leftovers to check after removing:**
- `btm-audit` again: an `SMLoginItem` inside a trashed app keeps launching **from the Trash**
  (Sound Control did). `launchctl disable gui/501/<label>` now; BTM drops it when the Trash is emptied.
- Daemons and helpers: `/Library/LaunchDaemons`, `/Library/LaunchAgents`, `/Library/PrivilegedHelperTools`.
  `sudo launchctl bootout system/<label>`, then trash the plist and helper. Examples: Docker Desktop's
  `com.docker.socket`/`vmnetd` (they re-pointed `/var/run/docker.sock` at a dead socket every boot),
  macFUSE `io.macfuse.app.launchservice.*`, MAMP helper.
- Audio HAL drivers in `/Library/Audio/Plug-Ins/HAL` (NoMachine `NMAudio*`, G Hub `LogiGamingAudio`).
  `ParrotAudioPlugin.driver` is Apple's: keep. Restart coreaudiod or reboot to unload.
- `pkgutil --pkgs | grep <vendor>` then `sudo pkgutil --forget <id>` for receipts.
- A brew record without the app (or with an older version than the app's own updater installed,
  like BetterTouchTool): trash `$(brew --prefix)/Caskroom/<token>` to untrack without touching the app.

### 6. On-demand instead of removing

- `launchctl disable gui/501/<label>` (or `system/<label>` with sudo) for updaters, agents and
  KeepAlive helpers. MachService-only daemons (ZoomDaemon) already start on demand: leave them.
- Finder/share extensions: `pluginkit -e ignore -i <bundle id>`.
- Login items: System Settings > General > Login Items, or `sfltool`.
- watchman can't be on-demand (re-registers its launchd job on every run). Instead prune:
  `watchman watch-list`, `watchman watch-del <stale worktree>`.

### 7. Record

Update the layer Brewfiles, rerun `catalog-apps`, and commit `Brewfile applications.md setup/unassigned.txt`
plus the layer files, **with explicit paths after `git commit --`** (Michael often has staged work of
his own in dotfiles; a bare `--` commits it too). Push.

## Disk pass

`du` over `~` takes over 10 minutes: run it in the background. All of these rebuild themselves
(sizes from 2026-11-08):

| What | Command | Was |
|---|---|---|
| uv wheel cache | `uv cache clean` (8.5M files: background it, ~15 min) | 140G |
| iOS DeviceSupport | keep the newest folder per device in `~/Library/Developer/Xcode/iOS DeviceSupport` | 89G |
| Xcode DerivedData | `~/Library/Developer/Xcode/DerivedData` | 27G |
| Gradle | `~/.gradle/caches` | 26G |
| pnpm | `pnpm store prune` | 10G freed |
| Docker build cache | `docker builder prune -af` (ask first, it slows next builds) | 17G |
| Dangling images | `docker rmi <id>` per `docker images -f dangling=true`, never `-f` | |
| npm / bun | `npm cache clean --force`, `bun pm cache rm` | 14G / 11G |

**Never** `docker volume prune` / `docker system prune`: unused volumes hold DB data of stopped
stacks. Load the `deleting-docker-resources` skill for anything Docker.

Not caches, ask first: `~/.anima/backups` (should now self-prune, iamclaudia-ai/anima#152),
`~/Projects/beehiiv/swarm.worktrees` (Michael checks in Swarm), `~/Backups/docker-volumes`.
Local models live in `~/Models` (`gguf/` LM Studio layout, `ollama/` HammerAI, `huggingface` ->
HF cache); orphaned model folders from removed chat apps belong there or in the Trash.

**Free space won't move right away.** Time Machine local snapshots (`tmutil listlocalsnapshots /`,
plus `com.kiliman.apfs-localsnapshot` every 15 min) hold deleted blocks until they thin out
(~24h, sooner under pressure). Michael prefers letting them expire. Trashed items count until he
empties the Trash.

## dcg rules for deleting under ~

- `rm -rf` under `~` is denied. `mv <path> ~/.Trash/` is allowed (no spaces in a renamed target),
  so trash, then Michael empties the Trash.
- `mv` of `~/.dotdir/...` or an absolute home path to `/private/tmp` is denied; `rm -rf` inside a
  **literal** `/private/tmp/...` path is allowed.
- No shell variables, loops or globs in `mv`/`rm` paths: spell out every literal path.
- Plain `rm <literal files>` (no `-r`) is allowed. `find ~ ... -delete` is denied.
- Check first with `dcg explain "<command>"`.

## Other gotchas

- `pkill -f <pattern>` kills the tmux-wrapped shell running it (the pattern is in its command line).
  Use `pkill -x <name>`.
- **Never `pkill bun` (any flags).** Anima's gateway, agent host and every extension are `bun`
  processes. On 2026-11-08, `pkill -x bun -f` meant for a throwaway server restarted all of Anima
  (the watchdog recovered it). Stop your own server by port or PID: `lsof -ti tcp:<port> | xargs kill`.
- Homebrew 7 moved the cask API to `~/Library/Caches/Homebrew/api/internal/packages.<tag>.jws.json`
  (scan-apps handles it). `executables.txt` is beside it.
- `lms ls` launches LM Studio; `lms daemon down` refuses while the app runs; `pkill -x "LM Studio"`.
- Spotlight on archive drives: `sudo mdutil -i off <volume>`; it doesn't stick on a Time Machine
  disk, and `mdutil -X` can hang.
- After a reboot, check the login items you expect actually started (Tailscale needed a manual
  Login Item: its own toggle errors).
- **Reinstalling Tailscale (App Store → standalone, or any fresh install) registers a new node
  with a new 100.x IP.** The old node stays as `<host>-old`. Cloudflare's `*.kiliman.dev` wildcard
  points at Vesuvius's Tailscale IP, so every Caddy host (anima, watchdog, code, ...) times out
  while Caddy itself is fine (`curl --resolve anima.kiliman.dev:443:127.0.0.1` returns 200).
  Fix: in the Tailscale admin console delete `<host>-old`, then Edit machine IPv4 on the new node
  back to the old IP (Vesuvius: 100.90.157.39). Check with `dig +short anima.kiliman.dev @1.1.1.1`
  against `tailscale ip -4`.
