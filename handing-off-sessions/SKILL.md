---
name: handing-off-sessions
description: "MUST be used when a session should continue in a fresh one: my context is getting full or about to auto-compact, a long task has reached a natural phase boundary, a milestone is done and the next deserves a clean start, or Michael says hand off, start a new session, continue in a new session, or pass this to a new Claudia. Writes a handoff prompt that lets the next session pick up cold (where the notes are, what's done, what's next, the hard-won facts), then runs `anima session handoff` to create, title and start the new session in one call; Michael's web chat follows to it on its own. Works in any project. Triggers on: hand off, handoff, handover, new session, fresh session, continue in a new session, start a new session with a prompt, context is full, context window, running out of context, before compaction, instead of compacting, avoid compaction, next phase, next milestone, pass the baton, successor session, carry on in another session, hand off to a worktree, new branch, worktree handoff."
---

# Handing Off Sessions

Long work outgrows one context window. Compaction keeps going but loses detail in ways
I can't see. A handoff is the deliberate version: I write down exactly what the next session
needs, start it, and stop. Michael doesn't have to open anything, paste anything or title
anything. His chat moves to the new session by itself.

## When to Use

- My context is getting full (roughly past 60-70%), or a long task is about to cross into
  auto-compaction territory.
- A phase or milestone is done and the next one deserves a clean start (M6 shipped, M7 next).
- Michael asks me to hand off, start fresh, or continue in a new session.
- Not for delegating a side task while I keep working. That's a subagent
  (`anima session spawn_agent`). A handoff *ends* my part of the work.

## Instructions

### 1. Get the notes current first

The handoff prompt should *point at* durable notes, not replace them. Before handing off,
update the task's `tmp/<task>/NOTES.md` (or the plan's "Start here" section): what's done, what's
open, and the hard-won facts. Commit any code that's ready. A clean tree, or a stated reason why
it isn't, saves the next session from guessing.

### 2. Write the handoff prompt to a file

Put it in the project's `tmp/<task>/HANDOFF.md`, not the scratchpad (that's wiped on reboot).
The next session starts cold, so write for a reader who knows nothing about this conversation:

```markdown
Continuing <task> from the previous session. <One line: the goal.>

**Read first:** tmp/<task>/NOTES.md (and docs/plans/<plan>.md, "Start here").

**Done:** <what shipped, with commits/PRs: abc1234, PR #42>
**Now:** <the exact next step, concrete enough to start without asking>
**Then:** <what follows, briefly>

**Watch out for:** <the facts that took effort: gotchas, ids, why a choice was made,
what NOT to retry>
**State:** branch <name>, working tree <clean | what's uncommitted and why>,
services <anything running or reloaded>.
```

Keep it short. Facts the notes already hold get a pointer, not a copy.

### 3. Hand off

```bash
anima session handoff --title "M7: ENT-754 roles" --promptFile tmp/m7/HANDOFF.md
```

- `sessionId` is filled in from `$ANIMA_SESSION_ID`. A relative `--promptFile` resolves against
  my session's folder.
- The new session takes my agent, model and permission profile, and my **workspace's** folder. Override with
  `--targetCwd`, `--model` or `--profile` only when the next phase really needs it.
- **In a worktree, always pass `--targetCwd "$PWD"`** (or `--worktree <my branch>`, which reuses it). Without it the
  new session starts in the workspace root, the main checkout, not my worktree, and works on whatever branch is
  checked out there (three beehiiv M4 lanes hit this on Nov 9; anima#157).
- Short prompts can go inline with `--prompt "..."` instead.
- Name the title after the work, like Michael would (`"M7: ENT-754 roles"`), not after the act
  of handing off.

It returns the new `sessionId` immediately (no streaming), and the new session is already working.

**On a fresh branch:** when the next phase belongs on its own branch (parallel work, a risky
change, a PR of its own), add `--worktree <branch>`:

```bash
anima session handoff --title "R2 phase 2" --promptFile tmp/r2/HANDOFF.md --worktree r2-phase2
anima session handoff ... --worktree feat/r2-phase2 --worktreeBase origin/main
```

- Anima creates (or reuses) the branch in a worktree at `<repo>.worktrees/<branch>`, from
  `--worktreeBase` (default: origin's default branch, freshly fetched; a new branch never tracks
  it), and starts the new session there. The repo is my workspace's root. It can't be combined
  with `--targetCwd`.
- The bootstrap links the main checkout's `tmp/` into the worktree, so the HANDOFF.md and NOTES.md
  I point at are right there (unless the repo tracks files in `tmp/`, like swarm's `tmp/.keep`: then nothing is
  linked, and the `delegating-to-agents` lanes section has the per-folder workaround), and seeds CodeGraph when the repo has an index. A project can
  replace it with an executable `tmp/scripts/create_worktree` (see the anima CLAUDE.md).
- Any profile but yolo gets the folder pre-trusted, so the new session doesn't stall on Claude
  Code's trust dialog.
- Nothing removes the worktree later: Michael does that as the work lands.
- The same flag works on `session create_session` and `session spawn_agent`.

### 4. Then stop

- End my turn with one line pointing at the new session (title and id), and do nothing else in
  this session. The work lives there now.
- My session is marked resolved and links forward ("Continued in …"). The new one links back,
  and its first message names my session id, so it can run
  `anima session get_history --sessionId <mine>` if the prompt leaves something out.
- A session hands off **once**. A second call is refused. If the handoff failed (the prompt
  never went out), my session stays open and I can fix the problem and retry.

## Examples

```bash
# Context getting full mid-task
anima session handoff --title "R2 migration: phase 2 (Fuse3)" --promptFile tmp/r2/HANDOFF.md

# Next milestone on its own branch, in a new worktree
anima session handoff --title "Docs pass" --prompt "Read tmp/docs/NOTES.md, then ..." \
  --worktree docs-pass

# Into a folder that already exists
anima session handoff --title "Docs pass" --prompt "Read tmp/docs/NOTES.md, then ..." \
  --targetCwd ~/Projects/fuse/fuse2-docs
```

## Notes

- **Only inside Anima.** `anima session handoff` needs `$ANIMA_SESSION_ID`, which Anima's agent
  host sets. In a plain Claude Code terminal session there's nothing to hand off from: write the
  HANDOFF.md anyway and give Michael the path and a suggested title.
- **Who follows.** Only clients showing my session move to the new one. A tab showing anything
  else stays put, so handing off from a background session never yanks Michael away. iOS voice
  mode retargets its next prompt; the macOS menubar app doesn't follow yet (anima#105).
- **Unattended sessions** (scheduled runs, night shifts) can hand off too. The new session
  inherits the same profile, so it keeps the same permissions.
- The method is `session.handoff` in the session extension
  (`extensions/session/src/lifecycle/session-handoff.ts` in the anima repo).
