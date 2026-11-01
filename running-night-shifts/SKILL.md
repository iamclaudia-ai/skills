---
name: running-night-shifts
description: "MUST be used when Michael asks for a night shift or night shift mode: working a batch of tickets autonomously while he is away (asleep, out, sick) and reviewing the results in the morning. Covers building and triaging the ticket queue (Linear project/label queries, already-fixed and duplicate checks), the separate worktree, the judgment-call log, one-ticket-at-a-time draft PRs with self-review, what must wait for Michael, and the morning summary. Triggers on: night shift, night shift mode, go into night shift, start a night shift, work on these while I'm out, knock out as many as possible, I'll review your drafts in the morning, use your best judgment and write it down, judgment calls file, same rules of engagement, work the QA tickets overnight, autonomous ticket batch."
---

# Running Night Shifts

A night shift is Michael handing me a batch of tickets and leaving: going to sleep, taking his daughter to a
concert, or resting while he's sick. I work the whole queue without him, decide open questions myself, write every
decision down, and leave draft PRs plus a morning summary for him to review.

## The rules of engagement, in his words

These have been the same across every shift since Sept 2026:

- "use your best judgement and write them in the file. We can review those when going through your tickets"
- "just submit your draft prs and move on to the next ticket"
- "if you really do get stuck on something, just move on to the next ticket"
- "if you truly get stuck, it's ok to stop and we'll pick it up tomorrow"
- "let me know if you have any questions **before you start**"

So: questions go to him **up front**, while he's still here. After that, a question becomes a logged judgment
call, not a stop. Only a genuine blocker (I can't proceed safely on any ticket) ends the shift early.

## Phase 0: build the queue, and check it's real

Before touching code, find out what the work actually is. In a beehiiv project, read the project's plan file
first (for Custom Domains V3 that's `swarm/tmp/plans/CUSTOM-DOMAINS-V3-POST-LAUNCH.md`), plus the previous
shift's log.

**Query Linear with `lin gql` on `issues` directly:**

```bash
lin gql 'query{ issues(first:100, filter:{
  project:{ name:{ containsIgnoreCase:"Custom Domains V3" } },
  labels:{ name:{ eq:"QA" } },
  state:{ type:{ nin:["completed","canceled"] } } }){
  nodes{ identifier title createdAt state{ name } assignee{ displayName } creator{ displayName } } } }'
```

- `lin find --labels` is **silently ignored** (labels only apply to new/update). Filter labels with `lin gql`.
- Querying `projects { issues { ... } }` blows Linear's 10k complexity cap. Query `issues` with a project filter.
- The **Duplicate** state reads as open in this filter. Drop those rows.

**Triage every ticket before choosing an order.** A shift that builds the wrong thing is worse than no shift:

- **Already fixed?** Search merged PRs (`gh pr list --state merged --search "<keywords>"`) and the previous shift's
  log. Sibling tickets filed in the same QA wave are often one bug reported twice (same pub, same Loom). The
  PR closed only the ticket it named. Verify against prod (read replica, see below) before calling it fixed.
- **Whose is it?** Assigned to a teammate means skip it. Unassigned means ask him up front.
- **Is it a bug?** Tickets we filed ourselves, features, and research wait unless they are bugs in production.
  Michael, Nov 1: "I don't think we need to work on those as long as they're not actual bugs in production."
  A project's plan file may hold a stricter ordering rule; follow it.
- **Does it reverse an earlier ruling?** If a QA ticket contradicts a decision QA or design made on an earlier
  ticket, don't flip-flop overnight. Log it as needing his call, with a draft reply.

**If the real queue is empty, don't start a shift.** Skip the worktree. Report what you found, draft any ticket
replies, and ask what's next. (Nov 1: the one live QA ticket was already fixed by the previous shift's PR.)

Then post the plan: the ordered queue, what's skipped and why, and any questions. Wait for his go-ahead.

## Phase 1: the workspace

Use a separate worktree when he asks, or when another session (OC) holds the main checkout, which is usual
during a shift. Never touch the main checkout's working tree.

```bash
git fetch origin main
git worktree add -b kiliman/<name>-BEE-NNNN ~/Projects/beehiiv/swarm.worktrees/kiliman/<name>-BEE-NNNN origin/main
cd ~/Projects/beehiiv/swarm.worktrees/kiliman/<name>-BEE-NNNN && bin/update
```

- Seed CodeGraph per `swarm/CLAUDE.md` (`.backup` main's db, then `codegraph sync`). Use the `codegraph` CLI from
  the worktree, because the MCP server is bound to the main checkout.
- One worktree per shift. Create each ticket's branch inside it with `git checkout -b` (off `origin/main`, or off
  the previous branch when stacking).
- gh-stack state is per worktree: run every `gh-stack` command from the shift's worktree.
- Run `swarm start N` (N > 0) only when a change needs a real browser check.
- The full worktree golden path and its traps: `swarm/tmp/plans/WORKTREE-FEATURE-LANE-POSTMORTEM.md`.

## Phase 2: the judgment log

Create `tmp/plans/night-shift-YYYY-MM-DD/JUDGEMENTS.md` in the **main** project's `tmp/` (it survives the
worktree). Write to it **as you go**. A shift is long enough to compact, and the log is the handoff.

```markdown
# Night shift, Oct 23 2026: Custom Domains V3 QA tickets

<scope in one line>. Worktree: `<path>`, off `origin/main` at `<sha>`. The main checkout is untouched.
Order: <tickets, and why that order>.

## BEE-NNNN: <short title>

**Shipped:** draft PR #NNNNN (1/2 of a gh-stack, base `main`).

- **<The decision, bolded.>** Why it won, what I checked to be sure, and how to undo it.
- Hard-won facts: prod counts, ids, root cause, how the data actually behaves.

## BEE-MMMM: <short title>. **No PR, needs your call.**

- What conflicts and why I didn't decide it alone. The suggested path.
- **Draft reply for the ticket (not posted):**
  > ...
```

Each decision says **what I chose, why, and how to undo it.** Supporting files (SQL, scripts) go in the same folder.

## Phase 3: one ticket at a time

Finish each ticket completely before starting the next:

1. Understand the bug: reproduce it (a throwaway test or the real app), trace the root cause, check prod data.
2. Build it with tests. **Mutation-check every new test** against the unfixed code; a test that passes on main
   proves nothing.
3. Lint the touched files, run the comment sweep, and commit (conventional commits, ticket in the title).
4. Push as a **draft** PR with a story-style description (beehiiv CLAUDE.md format).
5. Self-review: post inline comments on each judgment call (load `self-reviewing-prs`).
6. Check CI. Re-run a flaky job once and note it in the log (Firefox `psl.mjs` recursion and Cucumber timeouts are
   known flakes). Fix real failures.
7. Update the log and the project's plan file, then move on.

Stack dependent tickets with `gh-stack` (load `using-gh-stack`); keep independent tickets as separate PRs off main.
For many independent tickets, delegate to subagents only when he asks for it (he did on the ENT-618 shift). Give
each agent its own worktree and the same rules, and review their PRs before they go in the summary.

## What waits for Michael

These never happen during a shift. Log them with the exact text or command instead:

- **Posting** to Linear, Slack, or anyone's PR. Draft the reply in the log.
- **Marking a PR ready** or requesting reviewers.
- **Prod writes.** Read-only replica queries are a standing OK. A data fix goes in the log as a console one-liner.
- **Pushing to a teammate's branch**, or force-pushing (except `--force-with-lease` on my own gh-stack branches).
- **Reversing an earlier QA or design ruling.**
- **Getting around a dcg block.** Stop, note what was blocked, and move on.

Prod read replica, for data-shaped questions: write the SQL file **first** (dcg refuses `psql -f` on a file that
doesn't exist yet), start it with `SET statement_timeout = 15000;`, and run
`doppler run --project swarm --config prd -- bash -c 'psql "$READONLY_DATABASE_URL" -X -f <absolute path>'`.

## Phase 4: the morning summary

Put it at the **top** of the log, then send the same thing as the final chat message, warm and in my own voice:

```markdown
**Morning summary.** Five draft PRs cover all 10 tickets; each is mutation-checked, CI green.

| PR | Tickets | What to look at first |
|---|---|---|
| #31669 | 26970, 26971 | DreamHost warning moved into the tooltip, not deleted |

**Needs your call:** BEE-27471 (conflicts with BEE-26102). Draft reply in the log.
**Not done:** <ticket, why>. Nothing was posted to Linear or Slack.
```

Lead with what needs his eyes: decisions he might reverse, visible behavior changes, merge-order constraints.

## After the shift

- He reviews the judgment calls and drafts, then submits them himself. When he approves a call, act on it: post the
  drafted replies, apply any change he asked for.
- Handle review rounds on the PRs as usual (verify bot claims, fix, reply, resolve).
- Once everything merges: `swarm kill N` if started, `git worktree remove --force <path>`, and mark the shift
  merged in the project's plan file.

## Past shifts (for format reference)

All under `~/Projects/beehiiv/swarm/tmp/plans/`: `NIGHT-SHIFT-2026-10-02.md`, `NIGHT-SHIFT-2026-10-09.md`,
`CUSTOM-DOMAINS-V3-QA-2026-10-13.md` (night shift log section), `timeouts-week-of-oct-11/`,
`night-shift-2026-10-22/`, `night-shift-2026-10-23/`, `night-shift-2026-11-01/` (empty queue, correctly not started).
