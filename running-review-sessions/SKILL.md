---
name: running-review-sessions
description: "MUST be used when Michael wants to work through the PRs waiting on his review: a review session, clearing the review queue, or reviewing several PRs in a row. Runs check-review-queue (crq), takes a cursory look at each PR (size, stack, ticket, overlap with our own work), picks the review order itself, writes tmp/reviews/QUEUE.md, and chains one fresh session per PR (or per stack: a teammate's stacked PRs are one queue entry, reviewed bottom-up in one worktree) with anima session handoff, posting each review without waiting on Michael unless there is a question for him. Also MUST be loaded by a session started from a review-queue handoff, to take the next PR or stack, record the decision, and hand off to the one after. Covers queue order rules (follow-ups and re-requests first, stacks bottom-up, our project's PRs before others), stacked PRs from crq's stack field, quieting follow-ups that need nothing, and when the chain stops. Triggers on: review session, review a stack, stacked PRs, start a review session, review queue, check review queue, crq, clear my reviews, PRs waiting on me, work through my reviews, review these PRs one by one, review chain, next review, continue the review queue, which PR should we review first, review order, triage reviews, quiet this PR."
---

# Running Review Sessions

Michael gets several review requests at once. Reviews unblock teammates, so the goal is to get them out fast:
I dig in, decide the verdict, post, and move on, and I bring Michael in only when a review raises a question for
him. One session can't hold six full reviews, and subagents are wrong for it because he can only talk to me, not
to them. So a review session is a **chain**: a queue file
that holds the order and the outcomes, and one fresh session per entry, each handing off to the next. An entry is
one PR, or one whole **stack**: a stacked PR only makes sense next to its base, so a stack gets one session that
sees every layer.

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
check-review-queue        # from the repo root. `crq` works too (symlinked in ~/.local/bin)
check-review-queue --all  # also shows the hidden drafts, approved, quieted and team-requested PRs
```

For building the queue, use the JSON:

```bash
check-review-queue --json > tmp/reviews/crq.json
```

It lists follow-ups (PRs we reviewed that moved since), direct requests and re-requests. It already hides
drafts, PRs a human has approved (bot approvals like Unblocked don't count), quieted PRs, anything idle past
`--days`, and **team requests**. Trust its filtering; don't re-derive it.

The queue is only PRs that ask for Michael **by name**. A request to a team he's on isn't one: team membership
is a grab bag, and he doesn't want those reviewed by default. Don't queue them or offer them (`--team` lists
them if he asks).

**Stacks come from `crq --json`, not from guessing at base branches.** Each row carries:

- `parent`: the open PR whose head is this PR's base, `null` when it sits on the default branch.
- `stack`: every open PR in its stack, bottom first, the same array on every member; `null` for a lone PR. Each
  member has `number`, `title`, `author`, `isDraft`, `headRefName`, `baseRefName`, `parent` and **`inQueue`**:
  `true` for the PRs waiting on Michael, `false` for the rest (already approved, or never requested from him).
  The `false` ones are in the list because the session still has to check them out to see the queued layer.

Group the rows into queue entries by the bottom of their stack:

```bash
jq -r 'group_by(.stack[0].number // .number)
  | .[] | "\(.[0].stack[0].number // .[0].number)  queued=\(map(.number))  " +
    (.[0].stack // [] | map("#\(.number)\(if .inQueue then "*" else "" end)") | join(" → "))' tmp/reviews/crq.json
```

```text
34354  queued=[34354]  #34354* → #34355 → #34351 → #34352 → #34353 → #34610
34580  queued=[34602]  #34580 → #34602*
```

`*` marks the queued PRs. The second line is a queued PR sitting on one Michael doesn't need to review: still one
entry, with #34580 as context. A stack that forks (two PRs on the same base) is ordered by depth, so siblings sit
side by side.

### 3. Take a cursory look at each PR

Enough to order them, not a review. One call per PR:

```bash
gh pr view <N> --json number,title,author,baseRefName,headRefName,additions,deletions,changedFiles,body
```

For a stack, look at every member, queued or not (the context PRs tell you how much reading the session has
ahead). Note for each: size, its stack (from the JSON), the ticket, and whether it touches
our own in-flight work (our plan files and NOTES.md say what that is). For a follow-up, check what moved since
our review: `git log --oneline <our-reviewed-sha>..origin/<branch>`. If it's only a merge from main or
nothing that needs a reply, recommend quieting it instead of queueing it.

### 4. Pick the order and go

**Standing rule (Michael, 2026-11-12): "as soon as I ask for a review queue, just go ahead and do them in
whatever order that you deem fit."** Don't propose the order and wait. Show him the table as information and
start. These come first:

1. **Follow-ups and re-requests.** Michael's rule: "always focus on follow ups first since we've already
   reviewed them." The delta is small and the author is waiting on us specifically.
2. **A stack is one entry, reviewed bottom-up.** A stacked PR's review depends on its base, so the whole stack
   goes to one session, base first. Place the entry by its most urgent queued member: a stack holding a
   re-request sits with the follow-ups.
3. **Our project's PRs before others.** They touch code we're building on, and what we learn can change our
   own next step.
4. **Then everything else**, smaller first unless one is blocking someone.

Show Michael the table (PR or stack, author, size, why it's in that spot) and start. He can still reorder, drop or quiet
items whenever he likes. Add **tail work** (something that should run after the last review, like a ticket the
reviews unblock) only when he names it.

### 5. Write the queue, then start the chain

Write `tmp/reviews/QUEUE.md` (format below). If the queue is replacing an older one that's fully done, move
the old one to `tmp/reviews/archive/QUEUE-<date>.md` first.

- **This session has room** (started for the review session, or still light): review the first entry here.
- **This session carries other work's context**: update its notes (`handing-off-sessions` rules), then hand
  off to the first entry.

## Each review in the chain

1. **Read `tmp/reviews/QUEUE.md`**, including the notes carried forward to this entry.
2. **Run `check-review-queue` and reconcile:**
   - A new re-request or follow-up goes **right after** the current row.
   - A new request goes at the end, unless its `stack` puts it in a stack already on the queue: then it joins
     that entry (pending or current) instead of getting its own row.
   - A pending row that `check-review-queue` no longer shows (someone else approved it, it merged or closed, it went back to
     draft) becomes `skipped` with the reason. Tell Michael.
   - A stack whose queued PRs all dropped out goes `skipped`; one where only some did keeps going with the rest
     (the dropped ones become context).
3. **Mark the row `reviewing`**, then review it with `reviewing-prs-with-claudia`, the full process: worktree,
   mutation checks, findings plus a recommended verdict. Working files go in `tmp/reviews/<N>/`.
   **For a stack** (see [Reviewing a stack](#reviewing-a-stack)): one worktree for the whole stack, layers
   bottom-up, a review posted on each queued PR, the `inQueue: false` ones read for context only. Steps 4 and 5
   apply to each queued PR in turn.
4. **Decide and post** without waiting for Michael: post my verdict, verify it registered, and remove the worktree,
   per that skill (for a stack, only after the last queued PR is posted). APPROVE a clean PR or one with only nits; COMMENT when there are real concerns or the PR's own
   body says to hold the merge. **Hold and ask him** only when there's a question for him: a REQUEST_CHANGES-level
   blocker (that verdict is his call, never be the blocker by default), a product or relationship judgment, or
   something touching our own in-flight work in a way he should weigh. Then send a PushNotification with the
   question, mark the row `held: <question>`, and carry on with the next PR. Come back to it when he answers.
5. **Record the outcome** on the row: the verdict and one line on what we said. Anything the **next** entry
   needs goes under its notes, like "Phil said he'll fix Y in his next PR".
6. **Hand off to the next pending row:**

   ```bash
   anima session handoff --title "Review #33590: ENT-650 propagation job" \
     --prompt "Review session: take the next PR in tmp/reviews/QUEUE.md. Load running-review-sessions and follow 'Each review in the chain'."
   ```

   The prompt stays generic because the queue holds the state. Title it after the PR, so Michael's session
   list reads like the queue. For a stack, name the queued PRs and the theme: `Review stack #34354–#34610: ENT-700 exports`.

If Michael says "skip it" or "later", mark the row and move on. If he says "stop", leave the remaining rows
`pending` and don't hand off. The next `running-review-sessions` start will find the queue and offer to resume.

### Reviewing a stack

- **One worktree, checked out at the top.** A linear stack's top branch holds every layer, so
  `reviewing-prs-with-claudia`'s worktree goes on the top PR's `headRefName`. Fetch every member's branch first.
  A forked stack has more than one top: check out each tip in turn (`git switch` inside the same worktree).
- **Review each layer against its own base**, not against main, so each review covers only that PR's diff:
  `git diff origin/<baseRefName>...origin/<headRefName>`. Run the code at the layer being reviewed when its
  behavior differs from the top's (a later layer may already fix what a lower one breaks: say so, but the
  lower PR still merges on its own first).
- **Queued PRs (`inQueue: true`)** get the full review and a posted verdict each, bottom-up, so a finding in
  the base is posted before the layers that build on it.
- **Context PRs (`inQueue: false`)**: read them, don't review or post on them. If one hides a real problem,
  mention it on the queued PR it affects, or hold and ask Michael.
- Notes for the next layer up stay in `tmp/reviews/<bottom N>/NOTES.md`, so the session doesn't lose them
  between layers. If the stack is too big for one session, record which layers are posted on the row and hand
  off to the same entry; the next session picks up at the first unposted layer.

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
| 2 | stack **#33584** → **#33590** ENT-648/650 role history | philmillshub | +357/-3 and +1170, 36 files | reviewing |
| 3 | stack #34580 → **#34602** ENT-700 exports | philmillshub | #34602 +410/-22, 8 files | pending |

## Notes

### #33375 (re-request)
Order: re-request after our COMMENT on 2026-10-30. Outcome: approved, his community-level fix holds;
one nit on the copy.

### stack #33584 → #33590
Both queued. #33584 posted: APPROVE. For #33590: base renames X, check it uses the new name.

### stack #34580 → #34602
Queued: #34602. Context: #34580 (approved 2026-11-10). Outcome per queued PR: #34602 posted: COMMENT, ...
```

A stack row names every member bottom first, the queued ones in bold. Its status covers the whole entry
(`reviewing` until every queued PR is posted); the per-PR verdicts go in its notes.

Statuses: `pending`, `reviewing`, `posted: APPROVE | COMMENT | REQUEST_CHANGES`, `held: <question>`, `skipped: <reason>`, `quieted`.

## Quieting a follow-up

```bash
check-review-queue --quiet 32177     # hidden until the PR is updated after this moment
check-review-queue --unquiet 32177
```

Use it when a follow-up needs nothing from us, like a merge from main or replies that don't ask anything. It
comes back on any later update, including a bot comment, so it's a snooze, not a dismissal.

## GitHub's GraphQL budget

Everything running `gh` as Michael (his terminal, every session, Anima's /today board) shares **5,000
GraphQL points an hour**. `gh api graphql` and `gh pr view --json` draw from it; REST (`gh api repos/...`)
has its own 5,000. When it runs out, crq, cpra and every `gh pr view` fail with `API rate limit exceeded`
until the reset (2026-11-13: the board alone used it up).

- **Check it (free):** `gh api rate_limit --jq .resources.graphql` gives `used`, `remaining`, `reset` (epoch).
- **Price a query without spending:** add `rateLimit(dryRun: true) { cost }` to it.
- **Cost follows the page sizes you ask for, not what comes back.** `search(first: 50)` with
  `reviewThreads(first: 100) { comments(first: 1) comments(last: 1) }` per PR is charged as 50 × 100 × 2
  requests (102 points) even for 11 PRs. crq and cpra now ask `issueCount` first (1 point) and fetch exactly
  that many (dotfiles 85694e9): cpra 102 → ~22, crq 106 → ~11. Do the same in any new query.
- Measured costs: crq ≈ 13 + 1 per stack author, cpra ≈ 23 + ~1 per PR whose checks it re-reads, a
  `gh pr view N --json statusCheckRollup` ≈ 1. The board's GitHub pass ≈ 36, at most every 5 minutes, and it
  pauses itself below 1,000 remaining (`extensions.today.config.githubReserve`).

## Notes

- **Outside Anima** (no `$ANIMA_SESSION_ID`) there's nothing to hand off from. Write the queue anyway, and
  give Michael the next title and prompt to start by hand.
- **The main checkout isn't part of this.** Reviews run in worktrees. Don't report or touch the shared
  checkout's branch, even if this session started on one.
- **Posting is mine unless there's a question.** Since 2026-11-12 the chain posts its own verdicts. Every review
  still gets the full process (run the code, mutation-test the claims, check the invariants), never a skim:
  Michael depends on that depth because he can't judge Rails quality himself.
