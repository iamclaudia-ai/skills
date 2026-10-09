---
name: working-with-google-docs
description: "MUST be used when reading, reviewing, commenting on, replying to, or editing a Google Doc (docs.google.com/document). Drives Michael's real signed-in Chrome through DOMINATRIX: exports a doc's full text as Markdown, snapshots comment threads with authors and replies, diffs snapshots to show which comments are new, posts replies to comment threads as Michael, and appends content (headings, paragraphs, tables) to the end of a doc. Triggers on: google doc, gdoc, docs.google.com, read this doc, review the doc, implementation plan doc, PRD doc, doc comments, who commented, new comments, reply to comments, respond to comments, post replies, comment on the doc, update the doc, add to the doc, add a section, add a glossary, append to the doc, edit google doc, track comments."
---

# Working with Google Docs

Google Docs has no API we can reach, but Michael's Chrome is signed in to his beehiiv and personal
Google accounts, and DOMINATRIX can drive it. Docs draws the page on a canvas, so the normal
"read the DOM" approach sees nothing. This skill packages the routes that do work.

## When to Use

- Michael shares a Google Doc link to read before a meeting, review, or summarize
- Tracking comment threads on a doc across sessions ("which comments are new?")
- Posting replies to comment threads on Michael's behalf
- Adding a section, glossary or table to the end of a doc

Load `controlling-the-browser` too if you need anything beyond these commands.

## Available Commands

Run through the anima skills runner. `doc` is a URL or a bare doc id. `profile` defaults to
`michael.carter@beehiiv.com`; pass `kiliman@gmail.com` for personal docs.

- **`read-doc <doc> <out.md> [profile]`**: the doc's full text as Markdown, plus its headings.
  Comments appear at the bottom as `[a]`, `[b]`... footnotes, **without authors**.
- **`snapshot-comments <doc> <out.json|folder> [profile]`**: every open thread, each message with
  author, relative time ("9:41 AM Today") and text.
- **`diff-comments <old.json> <new.json>`**: new threads, new replies, threads gone (resolved).
- **`post-replies <doc> <replies.json> [profile]`**: reply to threads. `replies.json` is
  `[["opening text of the thread's first comment", "reply text"], ...]`.
- **`append-html <doc> <content.html> <shot.png> [profile]`**: paste HTML at the end of the doc.
- **`undo <tabId> <shot.png>`**: Cmd+Z in the tab that made the edit.

## Instructions

### Reading and reviewing

1. `read-doc` into the scratchpad, then Read the file. The text plus footnoted comments is
   everything you need for a review.
2. `snapshot-comments` to learn **who** wrote each comment and what has been replied. Do this
   before drafting replies so you don't answer something already answered.
3. For an ongoing doc, keep snapshots in the project's notes folder and `diff-comments` the newest
   against the last one at the start of each session, so you can lead with what's new.

### Replying to comments (as Michael)

Comments post under Michael's name, so **he approves the wording first**. Draft the replies
somewhere he can read them, wait for his OK, then post:

1. Take a fresh snapshot and diff it: if someone replied since you drafted, revise first.
2. Write `replies.json`. The prefix only has to be the start of the thread's first comment, long
   enough to match exactly one thread.
3. `post-replies`. It verifies each post and stops at the first failure. It skips threads that
   already have the identical reply, so after a crash or a closed Chrome **just re-run it**.
4. Snapshot again afterwards, so the next diff shows only other people's activity.

### Adding content

1. Write the HTML. Docs maps `<h2>`, `<p>`, `<b>`, lists and `<table>` to its own styles. Give
   table cells inline borders (`style="border:1pt solid #000000;padding:5pt"`) and the header row
   `background-color:#f3f3f3` to match typical doc tables, or Docs imports them borderless.
2. `append-html`. It leaves its tab open and prints the tab id.
3. `read-doc` to confirm placement (and look at the screenshot). If it's wrong, `undo <tabId>`.
4. Close the tab: `anima dominatrix close_tab --tabId <tabId>`.

## Examples

```bash
S=/path/to/scratchpad
anima skills run working-with-google-docs read-doc "https://docs.google.com/document/d/14TZ.../edit" $S/plan.md
anima skills run working-with-google-docs snapshot-comments 14TZ... ~/notes/comments/
anima skills run working-with-google-docs diff-comments ~/notes/comments/2026-10-09-1236.json ~/notes/comments/2026-10-12-0910.json
anima skills run working-with-google-docs post-replies 14TZ... $S/replies.json
anima skills run working-with-google-docs append-html 14TZ... $S/glossary.html $S/after.png
```

## Notes

- **Why each route:** the `/export?format=md` URL redirects cross-origin, so `fetch` from the doc
  tab fails. The `/mobilebasic` view renders real HTML text. The comment sidebar
  (`.docos-anchoreddocoview`) is real DOM even though the page is canvas. Body edits go through
  the hidden input frame (`.docs-texteventtarget-iframe`): synthetic `keydown` (Cmd+ArrowDown is
  end of doc, Cmd+Z undo) and a synthetic `ClipboardEvent('paste')` with `text/html` both work.
- **Reply box quirk:** focusing the reply box resets it, so focus events must come before the
  text; otherwise the Reply button never appears. `post-replies` handles this.
- **Undo is per tab.** A new tab has an empty undo stack. That's why `append-html` keeps its tab.
  If the tab is gone, fix mistakes by hand or through File > Version history.
- **Inserting mid-document** isn't supported yet; only appending. Starting a **new** comment
  (anchored to selected text) isn't supported either; replies to existing threads are.
- Only open threads are in the sidebar. Timestamps are relative ("Today"), so read them next to
  the snapshot's date.
- A table of contents is a Docs element; most docs don't have one. Headings appear in the
  outline sidebar automatically, so a new `<h2>` needs no extra step.
- If Chrome is closed mid-run, DOMINATRIX reports no clients. Wait for the profile to reconnect
  (`anima dominatrix list_profiles`), then re-run; every command opens its own tab.
