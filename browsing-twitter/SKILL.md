---
name: browsing-twitter
description: "MUST be used when you need to read Twitter/X: a tweet, a whole thread, the replies to a tweet, its images, a user's profile or recent posts. Free path first (api.fxtwitter.com walks an author's thread, no key), then the official X API with Michael's pay-per-use bearer token for replies, search and users. Scripts included. Triggers on: read tweet, tweet URL, x.com link, twitter.com link, X post, twitter thread, tweet chain, replies to a tweet, what are people saying, read the replies, tweet images, search twitter, who tweeted, user's tweets, X API, twitter API, bird CLI."
---

# Browsing Twitter/X

Scripts are in `scripts/` next to this file (`~/.claude/skills/browsing-twitter/scripts/`). Each takes a tweet
URL (any `…/status/<id>` form, query string fine) or a bare id. Work files go in the project's `tmp/`.

## Pick the path

| Need                                                             | Use                                                     | Cost             |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ---------------- |
| One tweet, or an author's own thread (given its **last** tweet)  | `thread-up.sh <url>`                                    | free             |
| Everyone's replies, the full conversation                        | `conversation.sh <url> tmp/x/<name>.json`, then `print-conversation.sh` | $0.005 per post |
| Anything else in API v2 (user, timeline, search, a tweet's fields) | `x-get.sh '<path?query>'`                             | $0.005–0.01 per item |
| Bookmarks, likes, anything as @kiliman (user context)           | `xurl '/2/users/14352244/bookmarks?…'` (see below)      | $0.001–0.005 per item |

**Free first.** `thread-up.sh` walks `replying_to_status` upward through `api.fxtwitter.com`, printing text,
counts, media URLs and quotes. A thread link usually points at its first tweet, which has no parent, so the walk
shows just that one: ask for the last tweet, or check `replies` and go paid.

**Paid when you need replies.** Say the expected cost first if it's more than a dollar or so (the root's
`reply_count` is a floor: the thread of 103 replies returned 162 posts, $0.81). `conversation.sh` looks up the
conversation id, pages recent search (100 per page, `max-pages` default 10), adds the root, and writes
`{conversation_id, posts, users, media, errors}`. **Recent search covers the last 7 days only.** Older threads
need full-archive search (`tweets/search/all`), which costs more; ask Michael before using it.

```bash
S=~/.claude/skills/browsing-twitter/scripts
bash $S/thread-up.sh https://x.com/thekitze/status/2118237225100149214
bash $S/conversation.sh https://x.com/thekitze/status/2118237135698632943 ./tmp/x/bench.json
bash $S/print-conversation.sh ./tmp/x/bench.json          # most-liked first
bash $S/print-conversation.sh ./tmp/x/bench.json --time   # chronological
bash $S/x-get.sh 'users/by/username/thekitze?user.fields=description,public_metrics'
```

## Images

Screenshots often carry most of a thread's content: look at them before giving an opinion.
`thread-up.sh` prints `photo https://pbs.twimg.com/media/<id>.jpg?name=orig`; `conversation.sh` puts them in
`.media[].url`. Download with `curl -sL -o ./tmp/x/<id>.jpg "<url>"` and open with Read.

## Credentials and money

- `X_BEARER_TOKEN` (app-only auth) for Michael's **Kiliman** app (id 32402979, Pay Per Use), rendered into
  `~/dotfiles/secrets/apikeys.sh` from 1Password vault `Secrets`. The scripts source that file themselves.
- Credits: console.x.com → Credits (account 1270720339383738368). Prepaid; at 2026-11-07 the balance was $43.
- Prices (2026, pay-per-use): post read $0.005, user read $0.010, owned reads $0.001, post create $0.015
  ($0.20 with a URL). Billed per item returned, not per call.
## Bookmarks archive

Michael bookmarks things to read "later". We keep every bookmark locally (tweets get deleted) and read them for
ideas. Archive: `~/.anima/x-bookmarks/` (`X_BOOKMARKS_DIR`): `bookmarks.jsonl` (one per line, most recently
bookmarked first: url, author, created_at, full text incl. long posts, expanded links, media, quoted tweet,
metrics) and `raw/` (every API page as returned).

```bash
S=~/.claude/skills/browsing-twitter/scripts
bun $S/bookmarks-sync.ts                 # new ones since last sync; stops at the first saved one (~$0.05 if none)
bun $S/bookmarks-sync.ts --full          # walk the whole feed, fill gaps, refresh old records (~$4.60 at 838)
bun $S/bookmarks-show.ts --limit 50      # read, free; --offset N, --grep <regex>
```

- **X truncates the bookmarks feed.** A page that comes back short (a bookmarked tweet was deleted: 98 of 100)
  carries no `next_token`, so naive paging ends early. With 100 per page the feed "ended" at 98 posts (back to
  2026-05-29); the real feed had 833, back to 2018. The sync retries a short tokenless page from the same start
  at 50 → 20 → 5 before believing the end. x-cli's April 2026 export (303, from July 2025) was cut short the same way.
- **Order is bookmark time, not tweet id.** An old tweet bookmarked today has a low id, so "already saved" is a set
  lookup (x-cli's id watermark was wrong for this).
- History: `~/Projects/oss/x-cli` (a Python fork with its own OAuth, April 2026) is retired; its pages were imported
  with `bookmarks-import-xcli.ts`. Don't use x-cli.
- Reading for ideas: open the links and threads behind the promising ones (`thread-up.sh`, WebFetch); the
  bookmarked tweet is often just a headline. Ideas worth doing become issues in the relevant repo.
  Digests go in `~/.anima/x-bookmarks/digests/` (first one: `2026-11-newest-50.md`, a model for the format).
- **Weekly digest (scheduled).** Scheduler task "Weekly X bookmarks digest" (vesuvius, Sundays 9:00,
  id `461f3321…`) runs `scripts/bookmarks-weekly.sh`: sync + media, then, if anything is newer than
  `digests/LAST`, a yolo session titled "X bookmarks digest <date>" follows `references/weekly-digest.md` (digest,
  issues, `LAST` moved forward, a text to Michael). Log: `~/.anima/x-bookmarks/weekly.log`; `--dry-run` reports only.
  `bookmarks-show.ts --until <id>` shows just the bookmarks made after that one (`--count` for the number).
- **Media is archived locally** in `media/<tweet id>/` (photos at `?name=orig`, videos as MP4 ≤ ~2.5 Mbps,
  GIFs, and the quoted tweet's media as `q1-…`), with a `manifest.json` (status, files, sizes, durations). The
  sync saves new bookmarks' media itself (`--no-media` skips); `bun $S/bookmarks-media.ts` catches up
  (`--ids`, `--limit`, `--quality best`, `--refresh`). Free: URLs from fxtwitter, files from X's CDN.
  The API's `media.fields` only give a video's thumbnail; fxtwitter gives the MP4 variants. A tweet fxtwitter
  can't see (deleted, protected) falls back to the photo URLs the sync stored (status `partial`).
  `bookmarks-show.ts` prints the local paths. To watch a saved video, use the `watching-videos` skill.
- **The API serves only the newest ~800 bookmarks** (X's 2022 announcement; staff confirmed on the dev forum).
  The full walk on 2026-11-07 got 833, back to 2018, so the cap is at least that loose; anything older than
  the oldest archived one can't be fetched by API. Records stay in the archive after X stops serving them.
- **X articles** (`links: https://x.com/i/article/…`, tweet text empty) are free through fxtwitter:
  `curl -s https://api.fxtwitter.com/status/<tweet id> | jq -r '.tweet.article.title, (.tweet.article.content.blocks | map(.text) | join("\n"))'`.
- **Medium posts** return 403 to WebFetch (scribe.rip 404s, freedium has a bad cert). The author's RSS feed has the
  full text: `curl -sL -A "Mozilla/5.0" https://<author>.medium.com/feed`, then take the item's `<content:encoded>`
  CDATA and strip the tags (`python3 -I`, `re` + `html.unescape`).
- Videos can't be watched; the tweet text, thumbnails and replies are all you get. Say so rather than guess.

## User context: bookmarks and acting as @kiliman (xurl)

Bookmarks (and likes, DMs, posting) **refuse the app-only bearer token** ("Authenticating with OAuth 2.0
Application-Only is forbidden for this endpoint"). They need a user token. X's official CLI `xurl` (installed on
vesuvius, `brew install --cask xdevplatform/tap/xurl`) holds one for app `kiliman`, user `kiliman`
(id `14352244`), in `~/.xurl/auth.yml`. xurl is a curl for the X API: there are no bookmark commands, you call
the endpoint.

```bash
xurl /2/users/me                                                     # who am I
xurl '/2/users/14352244/bookmarks?max_results=20&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username'
TOKEN=$(xurl token)   # a valid user access token for curl; refreshes and saves if expired
```

- **OAuth 2.0 user tokens expire in 2 hours, and every refresh rotates the refresh token** (the old one dies).
  Only xurl's store stays current: `xurl token` and every `xurl` call refresh and persist it. Never refresh from
  a static copy, and never put the live tokens back into 1Password.
- **If xurl's token is ever lost:** generate a new access + refresh token on the app's Keys & Tokens page
  (OAuth 2.0 → Access Token → Generate), export it as `X_OA2_ACCESS_TOKEN`/`X_OA2_REFRESH_TOKEN`, and run
  `bun scripts/seed-xurl.ts` (needs the app registered first with `xurl auth apps add kiliman …`; sets expiry 0
  so the next call refreshes). Or log in:
  `xurl auth oauth2 --app kiliman kiliman` (callback `http://localhost:8080/callback` must be registered on the app).
- `xurl auth status` shows what's configured. **It is the only safe way to inspect auth.yml**: never cat it or
  `sed`-mask it (a BSD sed mask once failed and printed the secrets).
- `xurl mcp https://api.x.com/mcp` exposes X's hosted MCP (posts, search, timelines, bookmarks) over the same auth.
- Writes as Michael (bookmark add/remove, posts, likes) only with his explicit say-so.

## Traps

- The old `bird` CLI (@steipete/bird, cookie-based) is deprecated on npm and not installed. Don't reinstall it.
- `XAI_API_KEY` is Grok (xAI), not the X API.
- Recent search never returns the root tweet; `conversation.sh` fetches it separately.
- dcg blocks `>` redirects to shell-variable paths in one-liners (`> "t-$n.json"`): put loops in a script.
- Never post, reply, follow or like as Michael without his explicit say-so: it's his real account.
