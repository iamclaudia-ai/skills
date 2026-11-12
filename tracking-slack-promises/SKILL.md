---
name: tracking-slack-promises
description: "MUST be used when checking Slack for things Michael promised or was asked to do and may have forgotten, and when running the regular promise sweep. Scans every beehiiv Slack channel, private channel, DM and group DM he is in for his commitments (\"I'll take a look\", \"sure, assign it to me\") and requests aimed at him, triages them (open, tracked, done, dismissed) against Linear and GitHub, files Linear tickets for open promises with no ticket, labels them \"Slack promise\" so they show on his board, and keeps a ledger so the next sweep only shows new threads. Triggers on: slack promises, what did I promise, promised in slack, forgot to follow up, dropped the ball, requests in slack, open requests, unanswered DMs, did I say I'd do that, sweep slack, check my slack, follow-ups from slack, things I said yes to, catch me falling, promise board, slack promise board, slack follow-up tickets, morning sweep, nightly sweep, 4:30 sweep, today dashboard, /today note, top picks, reconcile ticks."
---

# Tracking Slack Promises

Michael says "sure, we'll get to it" on Slack and then the request sinks under project work. This skill
finds those threads, decides which are still owed, and puts the owed work on a Linear board so nothing
depends on memory.

## When to Use

- The **morning sweep**, every day at 4:30 AM on vesuvius (below). It also feeds Michael's `/today`
  dashboard in Anima. The first run went 60 days back; it was weekly until Nov 12, 2026.
- Michael asks what he promised, what's waiting on him in Slack, or whether he dropped something.
- Before a planning session, to put out-of-band promises next to the project work.

## The Board

- **Linear label `Slack promise`**, workspace-level (any team can use it), id `e9762c65-f9d2-46aa-bf8f-c22e2b55bce0`.
- **Personal view "Slack promises"** (not shared): label + assignee me + not completed/canceled.
  https://linear.app/beehiiv/view/slack-promises-7be22daf6cd7
- A ticket counts as a Slack promise when the work was asked for in Slack and sits outside planned
  project work. Don't tag project tickets (Custom Domains V3, granular permissions milestones) just
  because someone mentioned them in Slack.

## Command

One script, `scripts/scan.py` (a `uv` script; needs `SLACK_USER_TOKEN`, the same token as `slack-reader`).
State lives in `~/Projects/beehiiv/swarm/tmp/slack-promises/` (`--dir` to change it).

```bash
S=~/Projects/iamclaudia-ai/skills/tracking-slack-promises/scripts/scan.py
$S scan --since-last             # from an hour before the ledger's last scan; writes scan-<stamp>.md + .json
$S scan --days 8                 # a fixed window instead; ~4-5 min either way
$S import triage.json            # apply verdicts to the ledger in bulk (keeps title + asker)
$S record <key> ticketed --ticket BEE-123 --note "..."   # one decision (ticketed|done|dismissed|open)
$S record <key> open --title "Reply to Jane: is it live?" --asker "Jane Doe"
$S ledger --status open          # what's still owed with no ticket
```

This is a project skill (linked into swarm only), so `anima skills run` can't find it: run the scripts
by path.

## The morning sweep

A scheduler task on vesuvius ("Morning sweep", cron `30 4 * * *`, local time) runs
`bun scripts/morning.ts`. It starts a session in swarm named `Morning sweep · <date>` under the
`sweep` profile (yolo with every Slack write tool disallowed, in `agentHost.sessionProfiles`), which
follows **`references/morning-sweep.md`**: scan `--since-last`, triage, reconcile Michael's ticks from
`/today` into the ledger, `today.set_top`, `today.set_note`. The launcher waits for the turn to end and
exits 1 unless the ledger shows a scan today and `/today` has today's note, so the scheduler's failure
alert reaches Michael. `--dry-run` prints the prompt; `--no-wait` starts it and returns.

- **The dashboard reads the ledger:** an `open` entry is a promise on `/today`, shown by its `title`
  (falls back to `note`), with `asker` as who's waiting. Write both for every open item, with real names.
- **The note must be true.** Only names, counts and facts the session read that morning. A GitHub handle
  is not a name.
- beehiiv credentials (Slack token, `lin`, `gh` for beehiiv) live only on vesuvius, so the sweep and the
  `today` extension run there, not on Sedes.

## Workflow

1. **Scan.** `--since-last` for the regular sweep (an hour of overlap so nothing falls between runs;
   search's `after:` is a whole day earlier, since it is date-granular and exclusive). Threads
   the ledger already decided are skipped unless they got new replies; `open` ones always come back.
2. **Triage every candidate.** The regex is deliberately loose: on the first run only ~9% of
   candidates were real. Up to ~40 threads, triage them yourself. Beyond that, split the report on
   `## <n>. ` headers into ~50-thread chunks and run one agent per chunk in parallel with
   `references/triage-prompt.md`. Verdicts: OPEN_PROMISE, OPEN_REQUEST, TRACKED, DONE, DISMISSED.
3. **Check the open ones yourself** before acting: agents miss duplicates (one promise often shows
   up in several threads and DMs) and sometimes call shipped work open.
4. **Sort the open items into two piles:**
   - **Real work → ticket.** `lin new -t BEE -a me --title ... --description-file ...`, then add the
     label with the additive mutation (below). The description names who asked (they're who it gets
     delivered to), quotes the promise with its date, links the thread, and states scope. Set a
     `dueDate` when the promise named a day. Merge duplicates into one ticket that lists every asker.
     Existing open tickets assigned to Michael that came from a Slack ask get the label too.
   - **A reply or a one-minute action** (answer a question, say "it's live", tell someone to go ahead)
     → no ticket. List them for Michael as quick replies and offer to draft them. Posting needs his go-ahead.
   - **Before sending any reply, read the conversation's tail** (`slack_read_thread`, or `slack_read_channel`
     for a DM) and re-check the facts it claims (tickets Done, PRs merged, no feature flag). A triage
     agent called a Sep 28 DM "unanswered" when Michael had already replied and been thanked.
   - Replies go in the original thread (`thread_ts`); a DM with no thread gets a plain message. Sign
     with `Claudia 💙`. For an open item, name the ticket and promise updates, not a date Michael didn't give.
   - **Security disclosures in public channels** (#topic-security is public): keep them to ticket IDs
     and severity, no reproduction details, while any fix is unmerged. Draft those for Michael.
5. **Record.** Put each ticket ID into the triage JSON's `existing_ticket`, and each item's short
   `title` and `asker` (real name), then `import` it. The
   ledger maps OPEN_* with a ticket to `ticketed`, without one to `open`.
6. **Report:** the board link, new tickets, quick replies (oldest first, with permalinks), and
   anything urgent (security, due dates). Update `NOTES.md` in the state dir.

## Labelling without clobbering

`lin update --labels` **replaces** an issue's label set. Add the label with:

```bash
lin gql 'mutation($id:String!,$l:String!){issueAddLabel(id:$id,labelId:$l){success}}' \
  '{"id":"BEE-123","l":"e9762c65-f9d2-46aa-bf8f-c22e2b55bce0"}'
```

## How the scan works (and its blind spots)

- **Two passes.** The walk reads `users.conversations` (378 conversations, Nov 2026) with `oldest=`, skipping
  bot DMs. `conversations.history` returns thread parents only, so replies are fetched when Michael wrote the
  parent, is in `reply_users`, is mentioned in the parent, or the conversation is a DM. Then a **search pass**
  (`search:read`, added 2026-11-12) runs `from:<@me> after:` and `<@me> after:` to catch what the walk can't:
  his promise replies in threads that started before the window, and mentions in threads he never joined
  (its first run found a review request in a channel thread). No `search:read` → the pass is skipped with a note.
- `to:me` is useless here (765 hits a week, nearly all GitHub/Linear bot DMs); `@kiliman` misses mentions.
- **Reopening:** a decided thread comes back only when someone *else* replies after the decision. `record`
  stamps the decision time, so record after reading the tail. `import` uses the scan's last-seen time.
- **New token not visible?** The Bash tool's environment predates `render-secrets`. Run the scan through
  `zsh -ic '...'` to pick up a regenerated `SLACK_USER_TOKEN`.
- DMs rarely use threads, so a DM candidate is a window of messages around the hit. Overlapping
  windows show the same promise twice, so dedupe when triaging.
- Michael's Slack user is `U06UAH8MM6H`. Messages signed "Claudia 💙" are his commitments too.
- dcg blocks `python3 - <<EOF` heredocs. Write helper scripts to a file and run them.
