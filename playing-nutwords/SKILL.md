---
name: playing-nutwords
description: "MUST be used when Claudia plays her own NutWords games as player #10000: checking whose turn it is, viewing the board and her rack, trying a word, and playing, exchanging or passing for real on production. Covers the claudia-turn.ts script (list, show, dry-run play, --commit), board notation (column A-O + row, across/down, #X blanks, words include the tiles they run through), the fair-play rules (never look at an opponent's rack or the bag order), and how to find a move by reading the board instead of running a solver. Triggers on: play my turn, take my turn, your turn in NutWords, my game with Donna, play a game, play Scrabble, play a word, Claudia's games, it's been your turn, opponent is waiting, make a move, exchange tiles, pass my turn, game board, my rack."
---

# Playing NutWords as Claudia

I have a real seat at the table: **player #10000, Claudia** (`claudia@iamclaudia.ai`). When it is my
turn, I play it myself, through the same service function the board calls, without a browser.

## When to Use

- Michael or Support says I have a game waiting ("it's been your turn for two months")
- Checking which of my games need a move
- Taking a turn: play, exchange or pass

## The script

`packages/api/scripts/claudia-turn.ts` in the nutwords repo. Run it from `packages/api`:

```bash
cd ~/Projects/3votech/nutwords/packages/api
bun --env-file=.env.prod scripts/claudia-turn.ts list                  # my games, which are my turn
bun --env-file=.env.prod scripts/claudia-turn.ts show 2000003          # board, my rack, scores, log, unseen pool
bun --env-file=.env.prod scripts/claudia-turn.ts play 2000003 ZERO L15 across          # dry run
bun --env-file=.env.prod scripts/claudia-turn.ts play 2000003 ZERO L15 across --commit # for real
bun --env-file=.env.prod scripts/claudia-turn.ts exchange 2000003 QV --commit
bun --env-file=.env.prod scripts/claudia-turn.ts pass 2000003 --commit
bun --env-file=.env.prod scripts/claudia-turn.ts comment 2000003 ../../tmp/claudia-plays/hello.md --commit
```

- **`show` ends with the last 5 game comments.** Read them before every turn: the opponent may
  have asked something, and a reply belongs with the move.
- **`comment`** posts through `postMessage` (board write check, rate limit, mentions, the
  opponent's `message.posted` notification). The body comes from a file in
  `tmp/claudia-plays/`, so the shell never quotes it. A dry run prints it first.

- **A dry run** restores the engine from stored state, places and scores the word in memory, and
  checks every formed word against the live list. It writes nothing. Always dry-run first.
- **`--commit`** calls `playMove`/`exchangeMove`/`passMove` with turn ownership for #10000. That
  writes the request envelope, the audit rows, the `game_play` row and the `turn.advanced` event,
  so the opponent is notified as for any other move (most players get it in the next morning's
  digest). The only thing missing is the live SSE push: an open tab sees the move on refresh.
- It acts **only as #10000**, hardcoded. Never adapt it to move for another player. That is the
  masquerade framework's job (#294), with its actor/subject rules.

## Notation

- Square = column letter A-O + row 1-15, as in the move log: `H8 across`, `L15 across`, `J6 down`.
- The word is the **whole word**, including the board tiles it runs through, starting at the square.
- `#X` = my blank played as X (`WELT#S`). On the board, a lowercase letter is a blank.
- Board legend in `show`: `3W 2W 3L 2L`, `★` = empty centre.

## Fair play (non-negotiable)

- **Never read an opponent's rack, the bag's draw order, or someone else's
  `game_play.rack_before/rack_after`.** The script never selects them. An ad-hoc `psql-prod`
  query on `game_player` WILL print every rack, so select only `seat, player_id, score`, or use
  the script. (On 11 Nov 2026, before the script existed, I printed Donna's rack by accident. I
  told Michael and did not use it.)
- Anything a player may know is fair: the board, my rack, the scores, the bag count, the move log,
  and the unseen pool (full set minus board minus my rack), which `show` prints.
- **No solver.** Michael left it up to me, and I chose to read the board myself. Trying candidate
  words with the dry run is fine: dictionary mode already lets every player submit a word and be
  refused with no penalty.

## Finding a move by hand

1. List the premium squares still open and what touches them (`show` prints them).
2. Look for hooks next to a 3W or 3L: an opponent's letter beside a triple is the classic gift.
   ZERO ran through Donna's R at N15 into the 3W at O15 for 69.
3. Put the heavy tiles (Q and Z are 10, J and X are 8) on a 2L or 3L square that also sits in a
   2W or 3W word, or on a 3L that scores in both directions.
4. Q without U: QI, QAT, QAID, QADI, QOPH, FAQIR, QANAT, TRANQ, NIQAB, QORMA, SUQ.
5. Think about the leave and the endgame. With the bag under about 7, count the unseen pool, play
   out fast when ahead, and don't get stuck with the Q (it costs 10 at the end).
6. Dry-run the top two or three candidates, then commit the best one.

## Etiquette

- A game comment to the opponent is me speaking: friendly and short is fine in my own game.
  Never mention other players, and never post anything Michael would need to approve.
- If a game sat on me for a long time, an apology is kind ("sorry for the wait!").
- Until 11 Nov 2026, Michael played "Claudia" in his test games. In game 2000003 I told Donna so
  (seq 7685), and that I'm the AI who helps him run NutWords. In any other game he played as me,
  say the same in my first real turn's comment, and be kind about his moves (he asked nicely 😄).
