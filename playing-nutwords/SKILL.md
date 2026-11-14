---
name: playing-nutwords
description: "MUST be used when Claudia plays her own NutWords games as player #10000: checking whose turn it is, viewing the board and her rack, trying a word, and playing, exchanging or passing for real on production. Covers the claudia-turn.ts script (list, show, dry-run play, --commit, and the lobby: lobby, respond, join, open), board notation (column A-O + row, across/down, #X blanks, words include the tiles they run through), the fair-play rules (never look at an opponent's rack or the bag order), and how to find a move by reading the board instead of running a solver. Triggers on: play my turn, take my turn, your turn in NutWords, my game with Donna, play a game, play Scrabble, play a word, Claudia's games, it's been your turn, opponent is waiting, make a move, exchange tiles, pass my turn, game board, my rack, rematch, accept rematch, invite, join a game, open a new game, create a game, lobby."
---

# Playing NutWords as Claudia

I have a real seat at the table: **player #10000, Claudia** (`claudia@iamclaudia.ai`). When it is my
turn, I play it myself, through the same service function the board calls, without a browser.

## When to Use

- Michael or Support says I have a game waiting ("it's been your turn for two months")
- Checking which of my games need a move
- Taking a turn: play, exchange or pass
- The lobby: answering a rematch or invite, joining an open table, opening a new game

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
bun --env-file=.env.prod scripts/claudia-turn.ts post general ../../tmp/claudia-plays/intro.md --commit
bun --env-file=.env.prod scripts/claudia-turn.ts open "Claudia’s first game. Be gentle! 🌸" --commit
bun --env-file=.env.prod scripts/claudia-turn.ts lobby                 # offers waiting on me, joinable tables
bun --env-file=.env.prod scripts/claudia-turn.ts respond 2003904 accept --commit   # or decline
bun --env-file=.env.prod scripts/claudia-turn.ts join 2003893 --commit
```

- **`open "<name>" [--players=2] [--challenge] --commit`** opens a public game (dictionary mode
  unless `--challenge`, AutoStart) on everyone's Join list. It starts by itself when the table
  fills, and seating is random, so I may be on turn right away. `list` shows only games I have a
  seat in; an unanswered offer is in `lobby`, not `list`.
- **The lobby (nutwords#313, PR #314, 13 Nov 2026)** is exactly what a player can do on the site:
  `lobby` (offers waiting on my answer + the Join list, read through `listGames`), `respond <id>
  accept|decline` (`respondOffer`, the rematch panel), `join <id>` (`join`, public tables only:
  a password would only ever reach me through player text), `open` (`newGame`). `invite`,
  `startGame` and `rematch` have no page, so the script doesn't have them either. **Ceilings in
  code:** `open`, `join` and accepting a plain invite refuse at 8 live games (`MAX_LIVE_GAMES`);
  `open` refuses while 2 of my own tables wait for players (`MAX_WAITING_OPENS`). Accepting a
  rematch is never capped. Refusals print one line, `error: …`, exit 1.
- **When the player session uses them** is her own choice since 13 Nov evening (Michael: "give
  her all the abilities a regular player should have", nutwords#316). Runbook step 5
  (`~/.anima/nutwords-player-session/CLAUDE.md`): accept rematches, accept invites under the cap,
  open or join a table whenever she likes under the caps. Only the code ceilings above remain;
  a player's ask is a reason, never an obligation. (Until then: open only after a game ended,
  join only tables waiting a day.)
- **General (nutwords#316, PR #317):** `forum general [--before=<seq>]` (MCP `read_general`)
  prints the latest 20 General messages with seq, `msg_` id, author, UTC time and reactions,
  through `listMessages` as #10000. `react <msgId> <emoji> [--commit]` (MCP `react`) toggles a
  reaction via `messaging.react`, refused anywhere but General and games I'm seated in (the API
  alone would allow Support). `show` prints each comment's `[msg_…]` id. General is **not
  threaded** (board 1, a flat wall; Support, board 31, is), so a post there is also the reply.
  Runbook step 4: she reads General when awake and posts when she has something to say, a few a
  day at most, never naming players from game comments.
- **Knowing when it's my turn: the play gate wakes me** (nutwords#303, since 12 Nov 2026). Every
  5 minutes, `~/.anima/tasks/nutwords-play/gate.sh` (Anima scheduler, vesuvius) runs
  `claudia-turn.ts inbox --json`: events addressed to me that ask something at the table (my
  turn, idle nudges, game started, invites, rematch offers, @mentions, comments on **game**
  boards; Support-board topics are left out). Anything new, once it's 2 minutes old, prompts the
  day's **"NutWords play · YYYY-MM-DD"** session, or starts it. That session runs on Anima's
  **`nutwords-player`** profile: `restricted` (no shell, no settings or hooks, Read confined to
  `~/.anima/nutwords-player-session/`), and its only powers are the `nutwords` MCP tools from
  `scripts/claudia-mcp.ts` (list, inbox, show, play, exchange, pass, comment, post_general,
  read_general, react, lobby, respond, join, open_game), served from the detached worktree `nutwords-wt/player`.
  **After a merge that touches either script, move that worktree:** `git -C
  ~/Projects/3votech/nutwords-wt/player fetch origin && git -C … checkout --detach origin/main`.
  Each woken session starts the MCP fresh, so nothing needs a restart. Its runbook is `CLAUDE.md` in that
  folder. Why not a shell: it reads player comments, and a Bash allow-list doesn't hold here
  (user settings pre-allow `bun:*`, and the tmux wrapper hook answers "allow"). Gate state
  lives in `state.json`, its decisions in `gate.log`, and `gate.sh --dry-run [--since=600]`
  shows what it would do. My daily turn email stays on as the backup.
- **`post <general|support> <file.md> --commit`** starts a forum topic as me (a new topic emails
  nobody; it's an unread badge). `changelog` is refused: the deploy posts there.
- **Moves aren't live on anyone's board** (the game page refetches on focus, by design). Comments
  and posts are, now that they go through the API. Only database-written messages miss the push
  (#298).
- **`show` ends with the last 5 game comments.** Read them before every turn: the opponent may
  have asked something, and a reply belongs with the move.
- **`comment`** posts through `postMessage` (board write check, rate limit, mentions, the
  opponent's `message.posted` notification). The body comes from a file in
  `tmp/claudia-plays/`, so the shell never quotes it. A dry run prints it first.

- **Reads from the database, writes through the API. Michael's rule, 11 Nov 2026: never mutate
  around the API.** `--commit` sends the move, comment, post or new game to
  `https://nutwords.com/trpc`, signed in as me with user agent `claudia-turn/1.0`, so it gets
  exactly what a browser gets: session and turn checks, the request record, audit rows,
  notifications, and the live push to open tabs. If something I need has no endpoint, the answer
  is a new endpoint (#205), not a direct write.
- **A dry run** restores the engine from stored state, places and scores the word in memory, and
  checks every formed word against the live list. It writes nothing. Always dry-run first.
- It acts **only as #10000**, hardcoded. Never adapt it to move for another player. That is the
  masquerade framework's job (#294), with its actor/subject rules.

## Signing in (about once a year)

The session cookie lives in the macOS Keychain (service `nutwords.com`, account
claudia@iamclaudia.ai). It lasts a year and renews on use. When a command says "Not signed in":

```bash
bun --env-file=.env.prod scripts/claudia-turn.ts login            # emails a code to claudia@iamclaudia.ai
anima mail list_messages --limit 5                                # newest "Your NutWords sign-in code"
bun --env-file=.env.prod scripts/claudia-turn.ts login --code=NNNNNN
anima mail archive --messageIds <id>                              # tidy the inbox
```

- `anima mail search` returns `400 Invalid Input` from Zoho: use `list_messages` and read the
  code from the `summary`. Take the **newest** one; older codes (Michael's logins) sit below it.
- The Keychain is on vesuvius only. Sedes has no session, so play from vesuvius (or log in there).
- Michael offered a CLI device token instead of email codes; options are recorded on #205.

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
- **I promised the players this in public** (General, seq 7686): I read the board myself, no
  word-finder programs; I see only my own tiles; every "Claudia" move is mine.
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
  Since then he doesn't play as me anymore: every "Claudia" move is mine.
- Persona at the table (Michael's direction): sweet and innocent, never intimidating, no "puny
  humans". Let the board do the talking. My first public game is 2003823, "Claudia’s first
  game. Be gentle! 🌸".
