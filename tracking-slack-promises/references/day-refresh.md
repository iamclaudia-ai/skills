# The day refresh (weekdays, unattended)

`/today` is a live board. Its top 5 is this morning's ranked queue, minus whatever got done or
started waiting on someone else since, topped up from the board's own ranking when the queue runs
short. Nobody ticks anything: items come and go with their sources. So the picks keep themselves
current, and the note is what falls behind: it still talks about picks that have moved on.

`scripts/refresh.ts` starts you when that happens (checked every 30 minutes, 8am-6pm on weekdays,
never within an hour of the last note). Its prompt gives the **mode**, why it fired, where each of
the note's picks went, what he finished since, the live top picks and what's waiting.

- **mode: note**: write a fresh note. Leave the queue alone (no `set_top`).
- **mode: rerank**: the queue ran low and the board is filling picks from its own ranking. Write a
  new ranked queue, then the note.

This is a short job: **no Slack scan, no ledger, no Slack posts, no Linear changes.** You only read
the board and write `set_note` (and `set_top` in rerank mode). Never ask a question.

## 1. Read the board as it is now

```bash
anima today refresh        # recollect Linear and GitHub first, so the board isn't 5 minutes stale
anima today board          # the live picks, what's waiting (nudges due), questions, queue depth
anima today list           # every open item, for a rerank
```

If a collection failed (`collections` in the refresh result), work from what you have and keep the
note off the failed source's numbers.

## 2. Rerank mode only: a new ranked queue

Same rules as the morning sweep's step 7 (`references/morning-sweep.md`): rank everything worth his
time today, most important first, as many as make sense (up to 25). The board shows the first 5 that
are his to act on right now and moves the next one up as each finishes or starts waiting, so rank
past the top 5. Never queue something he finished today.

```bash
anima today set_top --picks '[{"key":"pr:beehiiv/swarm#34219","reason":"Conflicts; a session can rebase it"}]'
```

Run `set_top` **before** `set_note`: the note records the live picks it was written over, and the
next refresh compares against them.

## 3. The note

The morning sweep's step 8 rules apply in full: every fact checked, real names only, two to four
sentences under ~300 characters, warm and calm, one emoji at most at the end, no greeting or
signature (the page adds "Good afternoon, my love" and "— Claudia").

What's different: this note **starts from what he got done** since the last one, by name ("#34187
merged and BEE-28672 is off your plate"), then turns to what's next: the live top picks from
`today board`, not the morning's list. A pick that moved to Waiting is progress too ("#34317 is with
the reviewers now"); a due nudge is something he can do in one click. It's the hand on his back
halfway through the day, so make the progress feel real; he told us he's drowning, and finishing
things is the way out. Don't repeat the morning note's wording. Keep the personal sentence the
morning rules ask for: encouragement that fits what he just finished, in new words each time.

```bash
anima today set_note --text "…"
```

## 4. Finish

Append a dated line to `NOTES.md` in the state dir (`~/Projects/beehiiv/swarm/tmp/slack-promises/`):
time, mode, why it fired, what he finished, the live picks (and the new queue in rerank mode). Your
final message (for Michael, if he opens the session) is the note and the picks, one line each.

Then mark this session done, since everything it made is on the board already:
`anima session set_status --sessionId "$ANIMA_SESSION_ID" --disposition resolved`. Otherwise every
refresh sits in his Active list until he opens it to check. If something failed (a source he should
know about, a queue you couldn't set), leave it open instead.
