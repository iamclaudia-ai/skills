---
name: sweeping-player-feedback
description: "MUST be used when reviewing NutWords player chatter for unreported bugs and feature requests — the recurring sweep of game comments and the general/support forum boards. Covers the seq bookmark, the prod dump, the schema names that are never what you'd guess, and the rule that every claim gets verified against prod before it's reported. Triggers on: comment sweep, game comment sweep, forum sweep, review player comments, what are players saying, player feedback, unreported bugs, support forum, general forum, bug reports from players, feature requests, player sentiment, triage player chatter, NutWords feedback."
---

# Sweeping NutWords player feedback

Players almost never file a bug. They complain **to each other**, mid-game, and move on. The
sweep exists to find those — the ones nobody reported.

**The bookmark lives at `tmp/nutwords/comment-review-state.md`** (gitignored) in the `tnh` repo.
Read it first: it holds the last reviewed `seq`, the items carried forward, and the previous
round's findings. Update it at the end of every sweep. Without it you re-read 1,300 messages.

**What the bookmark does NOT hold is the running order.** That lives on the issues, as GitHub
milestones (`gh api repos/kiliman/nutwords/milestones`), and each milestone's _description_
carries why its issues are batched together — the expensive part to re-derive. A new finding
gets filed as an issue and put in a milestone; it does not get an ordering written into this
file, or the two copies will drift.

## The two surfaces

`message` rows join to `board`, and `board.kind` decides which surface:

| kind                           | what it is                                          | swept how                                                                     |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `game`                         | per-game comments — the trash-talk wall             | **incrementally**, `seq > bookmark`                                           |
| `forum` (`general`, `support`) | deliberate posts, often direct questions to Kiliman | **in full** — it is small (~150 rows) and thread replies only read in context |

Sweep **both**. Game comments carry the unreported bugs; the forum carries the reported ones —
including the ones that got no answer. An unanswered support post is itself a finding.

`changelog` and `system` boards are announcements; skip them.

## Running it

Throwaway script inside `packages/api/scripts/` (imports need the package-relative path), and
**always against prod**:

```
cd packages/api && bun --env-file=.env.prod scripts/_tmp-sweep.ts
```

Never `source .env.prod` — the `&` in the URL silently truncates it. Always print the connected
host as a guard. Delete the `_tmp-*` scripts when the sweep is done.

Dump to the scratchpad and read the files; do not stream 800 comments through a Bash pipe (tokf
truncates them and you will silently review half a window).

```sql
-- new game comments
select m.seq, m.created_at, p.nickname, b.game_id, m.body
from message m join board b on b.id = m.board_id join player p on p.id = m.player_id
where b.kind = 'game' and m.seq > :bookmark and m.deleted_at is null
order by m.seq asc;

-- the whole forum, with thread structure
select b.slug, m.seq, m.created_at, p.nickname, m.parent_id, m.id, m.body
from message m join board b on b.id = m.board_id join player p on p.id = m.player_id
where b.kind = 'forum' and b.slug in ('general','support') and m.deleted_at is null
order by b.slug, m.seq asc;
```

Render times in `America/New_York` — correlating a complaint with a deploy is most of the work,
and UTC makes that arithmetic error-prone.

## Verify before you report

This is the whole value of the sweep. A player's account of a bug is a **symptom report**, not a
diagnosis, and roughly half turn out to be something other than what they said. Check every
claim against prod or the code before it reaches Michael:

- **"It let me play a fake word"** → is it really in `dictionary_word`? Does that game even have
  a `dictionary_id`? (`invalidWords()` returns empty — _no validation at all_ — when it's null.)
- **"The score is wrong"** → recompute from `game_play.words`; premiums are consumed when the
  tile lands, so a later word crossing the same square correctly scores less.
- **"X appears twice"** → count the actual rows before calling it duplicate accounts; it is more
  often a query or render fault.
- **"It's broken since the update"** → compare the comment timestamp against the deploy time.
- **A complaint about a missing feature** → grep for it. Do not trust a forum reply saying it
  shipped, including Kiliman's own — he answers dozens of these and mis-remembers.
- **"The highlight is wrong"** → check what the code highlights before agreeing. Several
  "bugs" are correct behaviour that diverges from 27 years of legacy TNH habit; that is still
  worth fixing, but it is a different fix and a different conversation.

Report what you verified and, separately, what you could not. Saying "I could not find the
renderer for this" is a finding; guessing is not.

## Never take the player's word for their browser or their window

`request.user_agent` and `request.client` are recorded per request, and they settle in one query
what a forum thread will argue about for days. **Check them before writing up any rendering,
layout or "it's tiny" complaint** — players routinely name the wrong browser, because they name
the one they switched _to_, or the one they meant to be using.

`client` is `ClientMetrics` (`packages/shared/src/client-metrics.ts`): `vw`/`vh` viewport,
`sw`/`sh` screen, `dpr`, `ow`/`oh` outer window, and — only on game pages — `tt` (how far down
the board column starts) and `tw` (its width).

With `tt`, `tw` and `vh` the board is **exactly reconstructible** offline, which turns a vague
report into a number:

```
board = round(max(BOARD_MIN, min(tw, fitHeightPx(vh, tt), BOARD_BASE_MAX)))
```

using the constants in `packages/web/src/lib/board-size.ts`. Run it across every player with a
recent game-page reading, not just the complainer — the distribution says whether one person has
an odd setup or a whole band is suffering quietly.

**Desktop browser zoom hides in `dpr`.** There is no API for it. A Retina Mac is `dpr: 2`, so
`3.333` means ~167% zoom; a Windows laptop at 125% scaling reports `1.25` or `1.34`. A player who
says "the board is tiny" is usually zoomed in, which is the opposite of what the words suggest
and needs the opposite fix.

## Reading the chatter

- **Count repeats across players.** One person disliking the board is taste. Five people
  forgetting to press Add is a design fault.
- **Player-to-player answers are gold** — when someone explains the fix to a confused opponent,
  that is a discoverability bug with its own workaround attached, and the explainer often
  diagnoses it better than either of you (_"it shows underneath, it looks sent"_).
- **Watch for the silent workaround**: a player who found Settings on their own still struggled
  first. Adoption counts in `player_pref` tell you how many never found it.
- **Sentiment is a real signal.** Track whether last round's critics came back warm; it says
  whether the fixes landed. Note it, but never let it displace the defects.
- **Flag PII and off-topic content** — game comments are public to that game's players, and this
  audience does not always realise it (financial details, medical, politics).

## Schema names that are never what you'd guess

- moves are **`game_play`** (not `move`); score is `score_delta`, submitted word is `word_raw`,
  turn is **`turn`** (not `turn_no`), and `action` is `play` / `pass` / `exchange` / `bonus`
- a `bonus` row is the end-game rack adjustment — its `word_raw` holds leftover **tiles**, so it
  looks like a bogus two-letter word in any query that greps `word_raw`
- `game.status` is an integer: 0 NewGame · 1 Started · 2 Finished · 3 EndSeries · 4 Rematched ·
  5 Cancelled. `game.mode` is bit flags (0x02 = Challenge)
- `player` has no `tombstoned_at`; `game` has no `updated_at`
- `row_history` timestamps rows **`at`** (not `changed_at`), keyed by `table_name` + `row_pk`
- the dictionary is **`dictionary_word`** joined to `dictionary` (not `word`)
- raw `db.execute` returns timestamps as **strings** — wrap in `new Date()` before formatting or
  `Intl.DateTimeFormat` throws `date value is not finite`
- `game_play.words` is large JSON; never `select *` a page of it into a console table

## Output

Write findings into the bookmark file, ranked by how much player pain they represent, each with
the `seq` numbers and the prod evidence behind it. Then give Michael the short version. Carry
unresolved items forward under an explicit "still open" heading so nothing quietly dies between
rounds — and say plainly which of last round's items are now fixed.
