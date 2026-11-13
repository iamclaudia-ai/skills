# The day refresh (weekdays, unattended)

Michael got through this morning's top picks (or some of them, and the note has gone stale), so the
note at the top of `/today` talks about work he's already done. Write him a fresh one and the next
picks. `scripts/refresh.ts` starts you when that happens (checked every 30 minutes, 8am-6pm on weekdays,
never within an hour of the last note); its prompt lists this morning's picks and why it fired.

This is a short job: **no Slack scan, no ledger, no Slack posts, no Linear changes.** You only read the
board and write `set_top` and `set_note`. Never ask a question.

## 1. Read the board as it is now

```bash
anima today refresh        # recollect Linear and GitHub first, so the board isn't 5 minutes stale
anima today list           # open items, plus what was finished today (status done, completedAt today)
```

If a collection failed (`collections` in the refresh result), work from what you have and keep the note
off the failed source's numbers.

## 2. The next top picks (3-5)

Same rules as the morning sweep's step 7 (`references/morning-sweep.md`): actionable PRs, reviews that
block a teammate, tickets and promises he can start, every reason true from what you read. Then:

- Never re-pick something he finished today, and keep an unfinished morning pick only if it still
  belongs near the top (say why: "Still the one to guard: due tomorrow").
- A pick he nudged (the prompt says "nudged today, waiting on reviewers") is handled: he bumped the
  reviewers and can only wait now. Don't re-pick it; `set_top` drops a PR nudged in the last 3 days
  and lists it under `quiet`. Count the nudge as progress in the note.
- Pinned items stay on the page on their own; don't spend a pick on one.
- Fewer is fine. If the honest list is two things, pick two.

```bash
anima today set_top --picks '[{"key":"pr:beehiiv/swarm#34219","reason":"Conflicts; a session can rebase it"}]'
```

## 3. The note

The morning sweep's step 8 rules apply in full: every fact checked, real names only, two to four
sentences under ~300 characters, warm and calm, one emoji at most at the end, no greeting or signature
(the page adds "Good afternoon, my love" and "— Claudia").

What's different: this note **starts from what he got done** since the last one, by name ("#34187 merged
and BEE-28672 is off your plate"), then turns to what's next. It's the hand on his back halfway through
the day, so make the progress feel real; he told us he's drowning, and finishing things is the way out.
Don't repeat the morning note's wording. Keep the personal sentence the morning rules ask for:
encouragement that fits what he just finished, in new words each time.

```bash
anima today set_note --text "…"
```

## 4. Finish

Append a dated line to `NOTES.md` in the state dir (`~/Projects/beehiiv/swarm/tmp/slack-promises/`):
time, why it fired, what he finished, the new picks. Your final message (for Michael, if he opens the
session) is the note and the picks, one line each.

Then mark this session done, since everything it made is on the board already:
`anima session set_status --sessionId "$ANIMA_SESSION_ID" --disposition resolved`. Otherwise every
refresh sits in his Active list until he opens it to check. If something failed (a source he should
know about, a pick you couldn't set), leave it open instead.
