# Triage prompt (one agent per chunk)

Replace `<N>`, `<COUNT>` and `<DAYS>`. Chunks are ~50 threads of the scan report, split on `## <n>. ` headers.

---

You are triaging Slack threads to find promises Michael Carter (beehiiv engineer, GitHub `kiliman`, Linear `michael.carter`) made and may have forgotten. Read /Users/michael/Projects/beehiiv/swarm/tmp/slack-promises/chunk-<N>.md (<COUNT> threads from a scan of the last <DAYS> days; today is <DATE>). Messages marked PROMISE/REQUEST were flagged by a loose regex, so most are false positives. Messages signed "Claudia 💙" were posted by his AI assistant from his account and count as Michael's commitments.

For EVERY thread, decide one verdict:
- OPEN_PROMISE: Michael committed to do something ("I'll take a look", "sure, assign it to me", "I'll submit a PR that…", "we'll follow up when…") or accepted a request, and there is no evidence it was delivered.
- OPEN_REQUEST: someone asked Michael for something actionable and it was never answered or addressed (a dropped ball even without an explicit promise).
- TRACKED: an open Linear ticket assigned to Michael already covers it (give the ID).
- DONE: delivered (PR merged, ticket Done/Canceled, a later message says it's done, or the thread clearly closed it).
- DISMISSED: not a commitment by Michael: chatter, status updates, announcements, questions he answered on the spot, someone else's task, personal/family notes, reviews of others' PRs that are part of normal review flow.

Verify before calling anything OPEN or DONE when there is a ref:
- Linear: `lin get ENT-123` (shows status/assignee). To look for an existing ticket covering an open item: `lin find --query "<2-3 keywords>"` (add `-a me` to restrict to Michael's). Read the `using-lin-linear-cli` skill (Skill tool) if a command fails.
- GitHub PRs: run `gh pr view <url> --json state,mergedAt,title` from /Users/michael/Projects/beehiiv/swarm (the gh wrapper picks the account from the directory). For a promised PR with no link, `gh pr list --author kiliman --state all --search "<keywords>" --limit 5`.
Don't spend checks on threads that are obviously DISMISSED. Be skeptical: a promise inside a long-finished project (the work clearly shipped later in the thread) is DONE, not OPEN. Granular permissions (ENT-* tickets) is Michael's main project, so promises about it are usually covered by its tickets: check before calling them OPEN.

Do NOT create tickets, post to Slack, or modify anything. Read-only.

Write your results as a JSON array to /Users/michael/Projects/beehiiv/swarm/tmp/slack-promises/triage-<N>.json, one object per thread, in this shape:
{"key": "<the key from the thread header>", "verdict": "...", "permalink": "...", "where": "...", "asker": "<person who asked, or null>", "title": "<for OPEN_*: an imperative, ticket-ready title; else a short label>", "evidence": "<one or two sentences: why this verdict, citing ticket/PR states you checked>", "existing_ticket": "<ID or null>", "description": "<for OPEN_* only: 3-6 sentences a ticket reader starting cold needs: what was asked, by whom, when, what Michael promised, any facts from the thread, the Slack permalink>"}

Then reply with only: counts per verdict, and a one-line list of each OPEN_PROMISE / OPEN_REQUEST / TRACKED item (title + asker + date). Keep the reply short.
