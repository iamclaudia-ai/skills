# Weekly bookmarks digest: runbook

Michael bookmarks posts on X "to read later", and later never comes. Every week the scheduler syncs the archive
and, when there is anything new, starts a session (this runbook) to read it for him and pull out what's worth
stealing. First digest, and the model for the format: `~/.anima/x-bookmarks/digests/2026-11-newest-50.md`.

Started by `scripts/bookmarks-weekly.sh` (Anima scheduler task "Weekly X bookmarks digest", vesuvius). The sync
and media download already ran; **don't sync again**.

## Steps

1. Load the `browsing-twitter` and `watching-videos` skills.
2. Read what's new since the last digest (the prompt gives the count; the marker is `digests/LAST`):
   ```bash
   S=~/.claude/skills/browsing-twitter/scripts
   bun $S/bookmarks-show.ts --until "$(cat ~/.anima/x-bookmarks/digests/LAST)" --limit 100
   ```
   Saved media is local (`saved:` lines): photos, and videos to watch with `watching-videos`.
3. Skim all of them, then go deep on the ones that matter to us:
   - links: WebFetch
   - X articles and Medium posts: the recipes in browsing-twitter's SKILL.md
   - threads: `thread-up.sh`
   - videos: `watch.ts <saved mp4>`, `--quality best` from the URL when there's screen text
   - images: Read the saved file
4. **What matters to us:** Anima (sessions, handoffs, memory/Libby, voice, skills, the web UI), Claude Code
   workflows and skills, agent memory, design engineering, home automation (Caseta, UniFi, Home Assistant), and
   Michael's projects (NutWords, the Expo apps). He works one-on-one with Claudia, not agent swarms, and is the
   bottleneck by choice: swarm tooling is "not us". Health and posture posts are for him personally: watch them
   and give him the routine in plain steps.
5. Write the digest to `~/.anima/x-bookmarks/digests/<YYYY-MM-DD>.md`: an "At a glance" list, then themes, each item
   with who, a one-line "what it is", why it matters, and the link. ★ marks the ones to act on.
6. Ideas worth doing become GitHub issues in the right repo (anima, skills, a project), written for a cold reader
   (problem, facts found, links, in and out of scope), per CLAUDE.md. A fit with an existing issue gets a comment
   instead. **Build nothing.**
7. Put the newest bookmark's id (entry 1 of step 2) in `~/.anima/x-bookmarks/digests/LAST`, replacing the old id.
8. Tell Michael by `anima notify send --source x-bookmarks --title "Bookmarks digest" --message "…"`: 3–5 highlights
   in a few warm lines, the issues filed, and the digest's path. Keep it short; it's a text message.
9. Leave a short summary as the session's last message, then mark the session done.

## Traps

- Videos often have only music or no audio; the content is on screen (see watching-videos).
- Don't pay for `conversation.sh` (replies) on old tweets: recent search covers 7 days only.
- Writes as Michael on X (unbookmark, like, post) are never part of this.
