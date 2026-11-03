---
name: running-review-sessions
description: "MUST be used when Michael wants to work through the PRs waiting on his review: a review session, clearing the review queue, or reviewing several PRs in a row. Runs check-review-queue (crq), takes a cursory look at each PR (size, stack, ticket, overlap with our own work), proposes a review order, writes tmp/reviews/QUEUE.md, and chains one fresh session per PR with anima session handoff so Michael can talk through every review. Also MUST be loaded by a session started from a review-queue handoff, to take the next PR, record the decision, and hand off to the one after. Covers queue order rules (follow-ups and re-requests first, stacks bottom-up, our project's PRs before others), quieting follow-ups that need nothing, and when the chain stops. Triggers on: review session, start a review session, review queue, check review queue, crq, clear my reviews, PRs waiting on me, work through my reviews, review these PRs one by one, review chain, next review, continue the review queue, which PR should we review first, review order, triage reviews, quiet this PR."
---

# Running Review Sessions

Michael gets several review requests at once, and each review is a conversation: I dig in, show him findings
and a recommended verdict, and post only after he decides. One session can't hold six of those, and subagents
are wrong for it because he can only talk to me, not to them. So a review session is a **chain**: a queue file
that holds the order and the outcomes, and one fresh session per PR, each handing off to the next.

## When to Use

- Michael asks for a review session, or to work through what's waiting on him.
- A session started from a review-queue handoff (its prompt names `tmp/reviews/QUEUE.md`): skip to
  [Each review in the chain](#each-review-in-the-chain).
- Not for one PR he names directly. That's just `reviewing-prs-with-claudia`.
- Not for my own PRs. That's `self-reviewing-prs`.

## Starting a review session

### 1. Check for a queue already in flight

Look for `tmp/reviews/QUEUE.md` in the repo. If it has pending rows, ask Michael whether to resume it or
rebuild. Don't silently overwrite a queue another session is working from.

### 2. Run the queue

```bash
crq        # alias for check-review-queue (~/dotfiles/scripts), run from the repo root
crq --all  # also shows the hidden drafts, approved and quieted PRs
```

It lists follow-ups (PRs we reviewed that moved since), direct requests, re-requests and team requests. It
already hides drafts, PRs a human has approved (bot approvals like Unblocked don't count), quieted PRs, and
anything idle past `--days`. Trust its filtering; don't re-derive it.

### 3. Take a cursory look at each PR

Enough to order them, not a review. One call per PR:

```bash
gh pr view <N> --json number,title,author,baseRefName,headRefName,additions,deletions,changedFiles,body
```

Note for each: size, whether its base is another PR's branch (a stack), the ticket, and whether it touches
our own in-flight work (our plan files and NOTES.md say what that is). For a follow-up, check what moved since
our review: `git log --oneline <our-reviewed-sha>..origin/<branch>`. If it's only a merge from main or
nothing that needs a reply, recommend quieting it instead of queueing it.

### 4. Propose the order

These come first:

1. **Follow-ups and re-requests.** Michael's rule: "always focus on follow ups first since we've already
   reviewed them." The delta is small and the author is waiting on us specifically.
2. **Stacks bottom-up, back to back.** A stacked PR's review depends on its base, so they sit together, base first.
3. **Our project's PRs before others.** They touch code we're building on, and what we learn can change our
   own next step.
4. **Then everything else**, smaller first unless one is blocking someone.

Show Michael a table (PR, author, size, why it's in that spot) and ask about **tail work**: something that
should run after the last review, like a ticket the reviews unblock. Wait for his OK. He may reorder, drop or
quiet items.

### 5. Write the queue, then start the chain

Write `tmp/reviews/QUEUE.md` (format below). If the queue is replacing an older one that's fully done, move
the old one to `tmp/reviews/archive/QUEUE-<date>.md` first.

- **This session has room** (started for the review session, or still light): review the first PR here.
- **This session carries other work's context**: update its notes (`handing-off-sessions` rules), then hand
  off to the first PR.

## Each review in the chain

1. **Read `tmp/reviews/QUEUE.md`**, including the notes carried forward to this PR.
2. **Run `crq` and reconcile:**
   - A new re-request or follow-up goes **right after** the current row.
   - A new request goes at the end.
   - A pending row that `crq` no longer shows (someone else approved it, it merged or closed, it went back to
     draft) becomes `skipped` with the reason. Tell Michael.
3. **Mark the row `reviewing`**, then review it with `reviewing-prs-with-claudia`, the full process: worktree,
   mutation checks, findings plus a recommended verdict. Working files go in `tmp/reviews/<N>/`.
4. **Wait for Michael's decision**, then post, verify, and remove the worktree, per that skill.
5. **Record the outcome** on the row: the verdict and one line on what we said. Anything the **next** PR needs
   goes under its notes: "base #33584 renames X, check #33590 uses the new name", or "Phil said he'll fix Y
   in the next PR up".
6. **Hand off to the next pending row:**

   ```bash
   anima session handoff --title "Review #33590: ENT-650 propagation job" \
     --prompt "Review session: take the next PR in tmp/reviews/QUEUE.md. Load running-review-sessions and follow 'Each review in the chain'."
   ```

   The prompt stays generic because the queue holds the state. Title it after the PR, so Michael's session
   list reads like the queue.

If Michael says "skip it" or "later", mark the row and move on. If he says "stop", leave the remaining rows
`pending` and don't hand off. The next `running-review-sessions` start will find the queue and offer to resume.

### When the queue is empty

Don't hand off to nothing. If the queue lists tail work, hand off to it with its own title and a prompt that
points at its notes. Otherwise tell Michael the queue is done, with a one-line outcome per PR, and archive the file.

## QUEUE.md format

```markdown
# Review queue: beehiiv/swarm (started 2026-11-03)

**After the queue:** ENT-923 delete dialog follow-up. Read tmp/plans/granular-permissions/HANDOFF-ENT-755.md.

| # | PR | Author | Size | Status |
|---|----|--------|------|--------|
| 1 | #33375 ENT-653 community level | philmillshub | +390/-17, 9 files | posted: APPROVE |
| 2 | #33584 ENT-648 role history | philmillshub | +357/-3, 17 files | reviewing |
| 3 | #33590 ENT-650 propagation job | philmillshub | +1170, 19 files | pending |

## Notes

### #33375 (re-request)
Order: re-request after our COMMENT on 2026-10-30. Outcome: approved, his community-level fix holds;
one nit on the copy.

### #33590
Stacked on #33584. Carried forward: ...
```

Statuses: `pending`, `reviewing`, `posted: APPROVE | COMMENT | REQUEST_CHANGES`, `skipped: <reason>`, `quieted`.

## Quieting a follow-up

```bash
crq --quiet 32177     # hidden until the PR is updated after this moment
crq --unquiet 32177
```

Use it when a follow-up needs nothing from us, like a merge from main or replies that don't ask anything. It
comes back on any later update, including a bot comment, so it's a snooze, not a dismissal.

## Notes

- **Outside Anima** (no `$ANIMA_SESSION_ID`) there's nothing to hand off from. Write the queue anyway, and
  give Michael the next title and prompt to start by hand.
- **The main checkout isn't part of this.** Reviews run in worktrees. Don't report or touch the shared
  checkout's branch, even if this session started on one.
- **Posting is always Michael's call.** The chain never posts a review he hasn't decided on, even when the
  verdict looks obvious.
