---
name: moving-projects
description: "MUST be used when moving, relocating or renaming a project's folder (a git checkout or any workspace folder), for example consolidating projects under ~/Projects/3votech or reorganizing ~/Projects. Moves the checkout and its git worktrees, keeps the Anima workspace and every session's history, re-points Claude Code settings, auto memory, task scripts and scheduler actions, trashes broken worktree leftovers, and tells open sessions where the project went. Plan first with --dry-run. Triggers on: move project, move repo, move checkout, move folder, relocate project, rename project folder, reorganize projects, consolidate under 3votech, move to 3votech, project moved, folder moved, mv a repo, change project path, move worktrees, workspace history after move."
---

# Moving Projects

A project folder has more attached to it than its files: linked worktrees, the Anima
workspace and its sessions, Claude Code's transcripts, auto memory and per-folder settings,
scheduled tasks and their scripts, and the sessions that remember the old path. A plain `mv`
breaks all of it. This skill moves everything together, the same way every time.

## When to Use

- Michael asks to move or rename a project folder ("move ~/Projects/tnh to ~/Projects/3votech/nutwords")
- Consolidating projects under an org folder (3votech for anything with billed services; some OSS stays with kiliman)
- A folder was already moved by hand: use `session.update_workspace --moveFolder` directly instead (this skill expects the old folder to still exist)

## Instructions

1. **Dry run first, always**, and read the plan:
   ```bash
   anima skills run moving-projects move --from ~/Projects/tnh --to ~/Projects/3votech/nutwords --name nutwords --dry-run
   ```
   It lists the worktrees and where they go, broken leftovers, live sessions to close, files and
   scheduler tasks it will rewrite, `~/.claude.json` entries, sessions to notify, and mentions it
   will only report.
2. **Look past what it finds.** It rewrites only live config it can be sure of. Also check, by hand:
   sibling folders that belong to the project but aren't worktrees (old clones, `*.worktrees`
   folders of gone worktrees, a workspace whose folder is already gone: merge it in with
   `update_workspace --addFolder <gone path> --merge true`), files outside the project that name it
   (an org gitconfig's comment), and anything Michael wants left where it is.
3. **Run it** without `--dry-run`. It refuses while a session in the folders is mid-turn.
4. **Check the result**: the "Check" section prints `git worktree list` and how many sessions are
   on the new path (expect 0 on an old one). Give open sessions a minute, then read one's reply.
5. **Deal with the report**: mentions in skills, dotfiles, `anima.json` or the repo's own files are
   listed, not changed. Fix what's live (a skill's example, a script), leave history (logs, dated
   reports, `~/memory` episodes). A path in the repo's tracked files is a commit for the project.

## What it does

| Thing | How |
| --- | --- |
| Worktrees | `git worktree move` to `<to>.worktrees/<branch>` (where `--worktree` puts new ones), then `git worktree repair` after the checkout moves |
| Broken worktree leftovers | A `.git` file pointing at nothing, under `<from>.worktrees`: moved to `~/.Trash` |
| Anima workspace | Worktrees recorded as folders, then `update_workspace --moveFolder` for each: sessions follow, the old paths stay as inactive folders, transcripts are linked at the new path (never renamed, so Libby doesn't re-ingest). `--name` renames it |
| Claude Code | The `~/.claude.json` project entry (trust, allowed tools, MCP approvals, local MCP servers) moves to the new key |
| Railway CLI | The `~/.railway/config.json` link (keyed by absolute path) moves to the new key, so `railway status` still finds the project |
| Old path in text | Rewritten in the project's auto memory, `~/.anima/tasks` scripts and runbooks (not `*.log`, not dated run folders) and scheduler task actions. Only where the path ends, so `tnh` never touches `tnh-legacy` |
| CodeGraph | Daemons stopped before, `codegraph sync` after |
| Sessions | Idle live ones closed first (their process would keep the old path; the reconciler revives the rows). Open ones get a `user_notification` with the new paths |

## Notes

- **Live sessions:** a session's Claude process keeps the cwd string it started with, so a live one
  in a moved folder would work from a path that no longer exists. That's why idle live ones are closed
  first and mid-turn ones block the move.
- **Notifications wake the session** (they're prompts). Resolved and archived sessions aren't told;
  the auto memory rewrite covers every future session.
- **Git identity:** check how the repo gets its identity before moving it under an org folder. A
  `includeIf "gitdir:~/Projects/<org>/"` in `~/.gitconfig` would change it; a repo-local
  `include.path` with an absolute path doesn't.
- **Sedes:** projects live on vesuvius; Sedes needs nothing unless its own config names the path
  (the script reports `anima.json` mentions).
- First used 2 Nov 2026: `~/Projects/tnh` → `~/Projects/3votech/nutwords` (2 worktrees, 17 sessions,
  the 4:50 AM deploy gate, 5 memory notes; OC confirmed from the new folder).
