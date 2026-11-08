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
| Bookmarks, likes, posting, acting as @kiliman                   | not set up: needs OAuth 2.0 user auth (see below)       |                  |

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
- **OAuth 2.0 user auth is not set up.** Bookmarks and acting as him need it: regenerate the Client Secret in the
  app's Keys & Tokens, add `http://localhost:8080/callback` as the callback URL, then use X's official CLI
  `xurl` (`brew install --cask xdevplatform/tap/xurl`, `xurl auth oauth2`, Michael approves in the browser).
  `xurl mcp https://api.x.com/mcp` then exposes X's hosted MCP (posts, search, timelines, bookmarks).

## Traps

- The old `bird` CLI (@steipete/bird, cookie-based) is deprecated on npm and not installed. Don't reinstall it.
- `XAI_API_KEY` is Grok (xAI), not the X API.
- Recent search never returns the root tweet; `conversation.sh` fetches it separately.
- dcg blocks `>` redirects to shell-variable paths in one-liners (`> "t-$n.json"`): put loops in a script.
- Never post, reply, follow or like as Michael without his explicit say-so: it's his real account.
