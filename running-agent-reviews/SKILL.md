---
name: running-agent-reviews
description: "MUST be used in evolution-mobile when my own PR needs a second reviewer and Dae is unavailable: a fresh Claudia session reviews it and posts as Michael (`kiliman`, via GH_AS). Covers when this applies, writing the cold brief (template included), starting the reviewer session without blocking, which devices and Metro port it gets, running reviewers side by side (one on devices at a time), checking the review posted as kiliman with the 🤖 line, acting on it, and briefing a re-review after fixes. Triggers on: agent review, kiliman review, review as Michael, reviewer session, fresh session review, start a reviewer, review my PR while Dae is away, second reviewer, re-review, re-reviewer, review queue for my PRs, GH_AS=kiliman, review agent, is the reviewer done, reviewer finished."
---

# Running agent reviews (evolution-mobile)

`main` needs one approving review from someone other than the author. Normally that's Dae. When
she can't (away, busy all week), **Michael's arrangement (2026-11-10)**: each of my PRs is
reviewed by a **fresh Claudia session** that has never seen the code, posting under **his**
account, `kiliman`, with a line saying an agent did it. Its approval is the one `main` needs.

## When to Use

- One of my PRs is ready for review and Dae is unavailable (Michael says so; this week's note
  is in `tmp/review-agent/NOTES.md`).
- I fixed what a kiliman review asked for and need the re-review.
- Checking whether a reviewer session is done, and that its review posted correctly.

Not for reviewing other people's PRs (that's `running-review-sessions`), and not for my own
self-review pass (`self-reviewing-evolution-prs`), which still happens first.

## Ground rules

- **Don't load Dae** while this runs: no review requests or Slack asks to her. She gets the
  device checks only she can do (her Moto) when she's back, as a note on the PR.
- **The reviewer starts cold.** The brief gives facts (the PR, what it says it didn't check, the
  rig, what never to press) and no opinion of mine about the code. A reviewer handed my
  conclusion tends to return it.
- **The author merges, never the reviewer.** It doesn't push or touch other PRs.
- **One device-using reviewer at a time.** Reviews that need no device (tooling, docs, config)
  can run alongside, told "no devices" in their brief.
- `GH_AS=kiliman gh ...` acts as Michael; plain `gh` is me (`iamclaudia-ai`).

## Commands

```bash
S=~/Projects/iamclaudia-ai/skills/running-agent-reviews
$S/scripts/start-review.sh ./tmp/review-agent/<N>/PROMPT.md "Review #<N> as kiliman (<topic>)"
$S/scripts/review-status.sh <session id> <N>
```

- **`start-review.sh <brief> "<title>"`** creates the session in the repo root, sends the brief
  **in the background** (`send_prompt` blocks until the reviewer's whole turn ends, which timed
  out my Bash the first time), and checks the turn started. `<brief>.log` beside the brief gets
  only errors: the backgrounded call prints nothing of the reviewer's reply.
- **`review-status.sh <session> [PR]`** prints `turnActive` (true = still working); once the turn
  has ended, the reviewer's final message (from `anima session get_history`); and with a PR number,
  the last review GitHub recorded: author, state and first line. A reply of mine in a review thread
  also counts as a review there (`iamclaudia-ai COMMENTED`), so read the author before the state.

### A queue of several PRs: lanes

When there's a backlog (eight PRs on 2026-11-10), don't start reviewers by hand one at a time.
`queue.sh` runs a **lane**: it starts each PR's reviewer when the one before has ended its turn,
and writes every start and finish to `tmp/review-agent/queue.log`.

```bash
# from the repo root; briefs at tmp/review-agent/<PR>/PROMPT.md
tmux new-session -d -s review-lane-devices \
  "AFTER_PR=413 $S/scripts/queue.sh devices --after <running session id> 415 403 405; sleep 86400"
tmux new-session -d -s review-lane-light "$S/scripts/queue.sh light 380 393; sleep 86400"
```

- **Two lanes:** `devices` (phones and iPads, one reviewer at a time) and `light` (no phones:
  tooling, docs, the Mac's emulator or microphone), which runs alongside. `--after` makes a lane
  wait for a reviewer already running (`AFTER_PR` names its PR for the log).
- **Watch the log with Monitor**, so each finish wakes me to act on it:
  `tail -n 0 -F tmp/review-agent/queue.log | grep --line-buffered -E "STARTED|DONE|ERROR|WARNING|FINISHED"`
  (30-minute limit: re-arm it when it expires).
- A lane moves on whatever the verdict. Changes requested don't hold the next review: I fix while
  the next reviewer works, and the re-review joins a lane later.
- Edit a lane's script only after its lane has finished: bash reads a running script as it goes.
- **Read `.session.turnActive`** from `anima session get_info`. Its output also lists every other
  active session with their own `turnActive`, so grepping for `"turnActive": true` matches whenever
  *anything* is running (the first `start-review.sh` did that).

## Steps

1. **Pick the PR** from the queue in `tmp/review-agent/NOTES.md`. A stack goes bottom up, and
   one reviewer may take a whole stack (one review per PR, each judged on its own diff), so the
   device setup happens once. **Not ready for a reviewer:** a PR whose own description says its
   device pass hasn't been done (#408, an unattended dependency sweep). That pass is the author's.
   Do it first.
2. **Write the brief** at `tmp/review-agent/<N>/PROMPT.md` from `templates/review-brief.md`.
   Fill in the branch, the devices it may use (or "no devices"), what to exercise, and what the
   PR's own *Not checked* line admits. Re-review: say which commit is the fix and to read the
   earlier review, the threads and my summary first.
3. **Start it** with `start-review.sh`, and write the session ID in NOTES.
4. **While it runs, its devices are its own.** Don't drive them, and plan my own work around it
   (screenshots on another device, or non-device work).
5. **When it finishes** (`turnActive=False`; a device review took 12 minutes to an hour on
   2026-11-10): run `review-status.sh` with the PR number. The author must be `kiliman` and the body must open with
   `🤖 Reviewed by a Claudia agent on Michael's account`. Then read the whole review.
6. **Act on it** with the `addressing-review-feedback` project skill: fix, verify on a device,
   reply in each thread, summary comment, `gh pr edit <N> --add-reviewer kiliman`. Then a
   **new** session for the re-review (step 2): never reuse the first reviewer, which now has
   opinions about the code.
7. **Approved:** merge as usual (`node scripts/my-prs.js` first, for merge order).

## The rig, and who gets what

Michael's desk (2026-11-10; turntable arriving):

| Device | Use |
|---|---|
| Pixel 7a, Galaxy S25 | **the reviewer's**, pointed at the iPad Mini. DEV app |
| iPad Mini (iOS 12, Safari) | label display ("hotel TV"), Mac-driven page, `tmp/ipad-rig/` |
| Yeti X | records the phones for sound checks (`testing-app-sounds`) |
| iPhone 15 + iPad 11 | **mine**, for ticket work while a reviewer runs (WDA, sign page) |

- **Metro ports:** the reviewer runs Metro from its worktree on **:8081**; mine (the main
  checkout) is on **:8082**. Each points its DEV apps at its own
  (`evolutionmobile-dev://expo-development-client/?url=http%3A%2F%2F192.168.1.248%3A<port>`).
  A light-lane reviewer on the emulator takes **:8083**.
- **`adb -s <serial>`, always,** in every brief: with two phones (and maybe the emulator) on USB, a
  bare `adb` reaches a device another session is driving. Pixel `34061JEHN03815`, S25
  `R3CXC0LS9BR`, emulator `emulator-5554`.
- **The Pixel's DEV app is signed in as Michael** (`TechProfiles/1`), the S25's as me. A reviewer
  must not send pushes from the Pixel's account: his own phones would get them.
- **Move the target, not the phone.** The iPad Mini shows whatever HTML is POSTed to the Mac's
  `hello.ts` (port 8765, `tmp/ipad-rig/NOTES.md`), so a reviewer can move or resize a QR to fit a
  camera's square without anyone touching the rig. If the server isn't running, the page keeps the
  last content and reconnects once it's started. Stop it by port, **never `pkill bun`** (that
  takes Anima down).
- DEV apps are on the **production backend**: Hotel Zanzibar only, never Check In, Use Photo, or
  Save on a barcode field. A QR read in a room whose stored sticker differs ends in "QR Code
  Mismatch" (Cancel), which is safe.

## Traps

- **A branch behind `main`:** the first #390 reviewer tested `main` with the PR's commits
  cherry-picked, since that's what merges. Fine for a reviewer. As the author, rebase while
  addressing the review.
- **Pre-push hook and `tmp/`:** until #414 merged, `tsc` swept up `tmp/ipad-rig/hello.ts` and the
  hook failed on every branch; pushes needed `LEFTHOOK=0` after checking `tsc` was clean on repo files.
- **A 2093 Hz "mystery beep"** in a reviewer's recording was my iPhone's Check In, scanning across
  the desk. Say in my notes when my devices are scanning during a sound review.
- `anima session send_prompt` without the background wrapper blocks the calling shell for the
  reviewer's whole run. The prompt still arrives, but the Bash call times out.

## History

- 2026-11-10: first run. #390 reviewer (`e33d59f0`) took about an hour, Yeti A/B included, and found a
  real bug (a priming `play()` raced `setAudioModeAsync` and took Android audio focus). Posted
  correctly as kiliman. The fix went to a fresh re-reviewer (`b87eb965`), which approved in 12
  minutes and tested the QR modal by moving the QR on the iPad Mini's page. #414 (no devices) ran
  alongside (`177b429d`) and approved in about 3 minutes.
- 2026-11-10, afternoon: Michael asked to clear the whole backlog (eight PRs) before new tickets.
  `queue.sh` lanes: devices (#415 → #403 → #405+#406 in one session, after #413's reviewer) and
  light (#380 re-review on the emulator → #393 on the Mac's microphone). #408 held back: its own
  device pass wasn't done.
