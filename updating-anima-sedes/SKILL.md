---
name: updating-anima-sedes
description: "MUST be used when updating, upgrading, deploying or syncing Anima on Anima Sedes (the always-on Mac Mini) or any second machine, when checking whether a machine is behind main, and when comparing or reconciling anima.json between machines. Reports incoming commits (migrations, watchdog, dependency and config-shape changes), fast-forwards main, runs bun install and watchdog:deploy when needed, restarts the watchdog through launchd, waits for health, and rolls back on failure. Also keeps the skills repo current there. Triggers on: update anima-sedes, update sedes, bring sedes current, deploy to sedes, pull latest on sedes, is sedes behind, sedes out of date, sync anima, upgrade anima, restart sedes, anima.json drift, compare config, config diff, sedes config, make sedes match vesuvius."
---

# Updating Anima Sedes

Anima Sedes is the always-on Mac Mini (`ssh anima-sedes`, user `claudia`). It should run the
same code and as close to the same config as vesuvius. This skill keeps it there.

## When to Use

- Sedes (or any second machine) is behind `main` and should be brought current
- Before relying on Sedes for something new, to check it is current
- After adding config to vesuvius's `~/.anima/anima.json`, to see what Sedes lacks
- Any time an update "worked" but behaviour differs between machines

## Available Commands

- **`update [--check] [--from <commit>]`**: run **on the machine being updated**. `--check` only reports. `--from` finishes an update that stopped after the fast-forward (pass the commit it started from). `--restart` only restarts and health-checks, for after a config or `.env` edit.
- **`config-keys`**: this machine's `anima.json` key paths, values elided.
- **`config-diff <ssh-host>`**: compare key paths with another machine. Run from vesuvius.

## Instructions

1. **Check first** (from vesuvius):
   ```bash
   ssh anima-sedes '~/.bun/bin/bun ~/Projects/iamclaudia-ai/skills/updating-anima-sedes/scripts/update.ts --check'
   ```
   Read the flags. 🗄️ migrations apply automatically on gateway start. ⚙️ config shape means
   step 3 matters.
2. **Update**:
   ```bash
   ssh anima-sedes '~/.bun/bin/bun ~/Projects/iamclaudia-ai/skills/updating-anima-sedes/scripts/update.ts'
   ```
   It fast-forwards, installs, redeploys the compiled watchdog when `packages/watchdog` or
   `packages/shared` changed, restarts the watchdog (`launchctl bootout`/`bootstrap` in the
   GUI domain, which works over ssh), and waits up to 2 minutes for every supervised service to
   be healthy *and* restarted after the update. Unhealthy means it rolls back to the previous
   commit and restarts again.
3. **Compare config** (from vesuvius):
   ```bash
   anima skills run updating-anima-sedes config-diff anima-sedes
   ```
   `<` lines are only on vesuvius, `>` only on Sedes. Some drift is intended (see Notes). Fix
   the rest by editing Sedes' `~/.anima/anima.json` with a small bun script that copies values
   from vesuvius's file over ssh **without printing them**, then run `update --restart` so the gateway
   reads it.

## Notes

- **Intended differences.** Sedes runs `imessage` and `claudeRuntime: "sdk"` (she works
  unattended; the CLI runtime's tmux panes are for interactive work). Vesuvius runs `mail`,
  `webhooks`, `support` and `editor` until those move: running mail or webhooks on both would
  process everything twice, and the Cloudflare tunnel points at vesuvius.
- **Never from the scheduler (yet).** The restart kills the scheduler running the script, so it
  refuses when `ANIMA_TASK_ID` is set (except `--check`). Automating updates needs the restart
  phase detached first.
- **Refuses a dirty checkout** or one not on `main`. Sedes' checkout is a deploy copy; nothing
  should ever be edited there.
- **Rollback is code only.** Migrations are additive and stay applied, which old code tolerates.
- **Paths differ.** Sedes' Anima checkout is `~/Projects/anima` (vesuvius:
  `~/Projects/iamclaudia-ai/anima`); the script finds either, or honours `ANIMA_REPO`. The skills
  repo is `~/Projects/iamclaudia-ai/skills` on both, and Sedes' `~/.claude/skills` links to it.
- Sedes' remote-shell gotchas (zsh globbing, PATH, no jq/tmux) are in my memory note
  `anima-sedes-access.md`.
