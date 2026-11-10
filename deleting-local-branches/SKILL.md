---
name: deleting-local-branches
description: "MUST be used whenever you need to delete, clean up, or prune local git branches, because dcg blocks `git branch -d` and `git branch -D` outright. Two commands: `merged` runs cleanup-local-branches (deletes branches whose PR merged, skips open/draft/closed-unmerged PRs), and `delete` removes branches I created myself that may have no PR (review checkouts, scratch and experiment branches, finished deps/sweep branches, worktree leftovers), only when no unpushed work would be lost, logging each SHA with a restore command. Triggers on: delete branch, delete local branch, remove branch, clean up branches, cleanup local branches, prune branches, stale branches, merged branches, git branch -D blocked, dcg blocked branch delete, branch-force-delete, tidy branches, delete review branch, delete my branches, remove old branches, branch cleanup after merge."
---

# Deleting Local Branches

dcg denies every `git branch -d` / `-D` (rules `core.git:branch-delete` and
`core.git:branch-force-delete`). This skill does the deleting inside scripts that
run their own safety checks first, so I can manage the branches I create without
asking Michael each time.

## When to Use

- After PRs merge: clear their local branches (`merged`)
- Branches I made that never became PRs: review checkouts, scratch/experiment
  branches, a deps sweep's leftovers, branches from a removed worktree (`delete`)
- Any time a branch delete was blocked by dcg

## Available Commands

Both run through the **anima skills runner**, which runs from the skill's
directory, so the repo is always passed as an absolute path.

- **`merged <repo> [flags]`**: runs Michael's `cleanup-local-branches`
  (`~/dotfiles/scripts`) in `<repo>`. Deletes branches whose PR was merged, skips
  open and draft PRs, and keeps closed-but-unmerged ones unless `--yes`. Flags pass
  through: `--dry-run`, `--yes`, `--no-pr`, `--open-pr`, `--archive` (rename to
  `zzz/` instead), `--merged` (git ancestry instead of PRs). `--prompt` is refused
  without a terminal.
- **`delete --repo <repo> [--prefix <p>]... [<branch>...] [--dry-run] [--force]`**:
  deletes the named branches and/or every local branch starting with a prefix.

```bash
anima skills run deleting-local-branches merged /Users/michael/Projects/iamclaudia-ai/anima --dry-run
anima skills run deleting-local-branches delete --repo /Users/michael/Projects/iamclaudia-ai/anima --dry-run review/pr-42 scratch/try-zod
anima skills run deleting-local-branches delete --repo /Users/michael/Projects/iamclaudia-ai/anima --prefix deps/
```

## What `delete` checks

A branch is deleted only when nothing would be lost:

1. It is **not** the default branch, the current branch, or checked out in any
   worktree. Nothing overrides this.
2. Every commit on it is **reachable from another ref** (its pushed remote, another
   local branch, a tag), **or** every commit has an **identical patch on the
   default branch** (`git cherry` marks it `-`: rebased or cherry-picked in),
   **or** its PR was **merged**. Squash merges leave the original commits
   unreachable, but their content is on the default branch.
3. Otherwise it is skipped with the count of commits that exist only there and the
   PR state. `--force` deletes it anyway: use it only for work I know is
   throwaway, since those commits survive only in the reflog (about 90 days).

Branches are checked one at a time against the refs that still exist, so two
branches sharing the same unpushed commit never vouch for each other: the first
goes, the second is then the only holder and is kept.

Each deletion is appended (branch, SHA, reason, time, repo) to the repo's
`tmp/deleted-branches.txt` when `tmp/` is git-ignored (the same log
`cleanup-local-branches` writes), else to
`~/.local/state/deleting-local-branches/deleted-branches.txt`. The output prints
`git branch <name> <sha>` to restore it.

## Instructions

1. **Dry run first**, every time: add `--dry-run` and read what would go.
2. Run it for real.
3. **Branches tracked by gh-stack:** drop them from the stack metadata first,
   children before parents, with `GH_STACK_YES=1 gh-stack delete --keep-branch
   <branch>` (metadata only, no git or remote change). Check with
   `gh-stack stacks --json`. `gh-stack doctor` does **not** prune deleted
   branches, and a stack emptied this way stays listed with no branches, which is
   harmless.
4. Only delete **my own** branches with `delete`: ones I created this session or
   that a skill of mine creates (`deps/*`, `review/*`, worktree branches). Michael's
   branches go through `merged` (merged PRs only) or wait for him.

## Tidying worktrees (before the branches)

A branch checked out in a worktree can't be deleted, and a worktree's **notes live in
git-ignored `tmp/` folders**, which `git status` never shows and `git worktree remove` silently
deletes (a `--delete-branch` merge once took a worktree's notes with it). So tidy worktrees with
`scripts/tidy-worktrees.sh`, run directly with zsh (not through the skills runner):

```bash
S=~/.claude/skills/deleting-local-branches/scripts/tidy-worktrees.sh
zsh $S survey <main checkout> <owner/repo>             # branch, PR state, changes, tmp notes
zsh $S remove <main checkout> <worktree>...            # dry run: lists what it would archive
zsh $S remove --commit <main checkout> <worktree>...   # archive to <main>/tmp/worktree-archive/, cmp, remove
```

Symlinks are listed but never archived (they hold nothing of their own). A worktree's
`node_modules` is usually a link into the main checkout, and git lists it as untracked because
`node_modules/` in `.gitignore` matches directories only; until 2026-11-10 `cp` followed it and
the remove stopped with `COPY FAILED node_modules`. Removing the worktree deletes the link, not
the main checkout's `node_modules`.

Remove only worktrees whose PR is **merged or closed** and that have no tracked changes (the
script skips those anyway). Leave a worktree with an open PR: another session is working in it.
Then delete the branches: `merged` for merged PRs, `delete` for the rest. **Pre-PR branches**
("No PR found") are usually all reachable from `main`, and `delete` without `--force` handles
those. For the few it skips, compare *content*, not commits, before forcing: is the feature on
`main` (`git grep`), did its PR merge under another branch name, is its only unique commit a
local merge? Keep spikes and anything really unique, and name them to Michael.

Remote branches of merged PRs go in **one** `git push origin --delete b1 b2 …`. A push made only
of deletions skips nutwords' pre-push hook. Afterwards: `git fetch --prune`.

**Guard traps on the way** (nutwords tidy, 2026-11-08): `find … -delete` is blocked; remove
empty leftover folders with `rmdir`, which only ever removes empty ones. Never pipe `gh-stack`
into `tail`/`head`. Writing inside `.git/` is blocked, so empty gh-stack stack shells (listed
with `"branches": []` after `delete --keep-branch`) stay unless Michael moves
`.git/.gh-stack/active/<name>.json` to `archived/` himself. They are harmless. `gh-stack archive`
can't help: it only lists and restores (kiliman/gh-stack#68 asks for `archive <name>`, or for
`delete` to archive a stack it empties). The zsh glob
`packages/*/tmp` aborts the command when nothing matches: `setopt nullglob` (the script does).

## Notes

- Remote branches are out of scope. `git push origin --delete <branch>` is allowed
  by dcg; use it only for branches of merged PRs or branches I pushed myself.
- Removing a worktree (`git worktree remove <path>`) does not delete its branch.
  Follow it with `delete`.
- `merged` needs `gh` and `jq` (except `--merged`), and `cleanup-local-branches` on
  PATH, which Anima Sedes may not have. `delete` needs only git (and `gh` to
  recognise merged PRs).
- Don't run `git branch -D` through `bash -c` or `eval` to dodge dcg. This skill is
  the sanctioned path because it checks first.
