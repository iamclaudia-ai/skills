---
name: extracting-claude-artifacts
description: "MUST be used when you need to read, run, inspect or click through a claude.ai artifact that the Artifact tool can't read (another org's or a teammate's artifact, a prototype shared by link), or when Michael hands you a HAR file of one. Extracts the artifact's HTML and its sibling files from the HAR, strips the claude.ai frame runtime so it runs standalone, and serves it locally for DOMINATRIX or agent-browser. Triggers on: HAR file, .har, HTTP Toolkit capture, claude artifact, claude.ai/artifact link, artifact not found, teammate's prototype, design prototype, run the artifact locally, convert HAR to local app, extract artifact, frame.claudeusercontent.com, can't open the artifact, read someone's artifact."
---

# Extracting Claude Artifacts from a HAR

A claude.ai artifact runs in a cross-origin iframe on `<uuid>.frame.claudeusercontent.com`, served
from `/_f/<version>/`. When the artifact lives in an account my Artifact tool can't reach (the
beehiiv Claude org, a teammate's private share), the only reliable way in is a HAR capture from
Michael's browser. This skill turns that HAR into a local folder that runs, reads and clicks like
the original.

## When to Use

- A `claude.ai/artifact/...` link and the Artifact tool's `read` returns not found or an unreadable summary
- Michael gives me a `.har` file of an artifact or prototype
- I need the artifact's real source (data, rules, screens), not a screenshot of it

**Try the Artifact tool first.** If `Artifact` `action: "read"` returns the raw HTML (Michael's own
artifacts, or ones shared with his personal account), I don't need any of this.

## Dead ends: don't retry these

Each cost real time on Oct 26 before the HAR approach worked:

- DOMINATRIX on the claude.ai tab only sees the wrapper; the iframe is cross-origin.
- Navigating the tab to the frame URL redirects back to claude.ai.
- `curl` on the frame URL (`_t?__frame_t=…`) returns 403.
- `/api/frame/<uuid>` fetched from the page returns not_found.

## Available Commands

Run through the anima skill runner (or directly with `python3 -I scripts/<name>.py`):

- **`list <har> [--all]`**: the frame files the HAR captured, grouped by frame and version: URL
  with the query stripped, status, type and size. `--all` lists every entry. Never prints headers.
- **`extract <har> <out> [--version <v>]`**: writes into a new or empty folder:
  - `index.html`: the page exactly as served, frame runtime included
  - `run.html`: the same page with the `<!-- frame-runtime -->…<!-- /frame-runtime -->` block removed
  - every sibling file served under the same `_f/<version>/` (scripts, data), at its relative path

  It warns when `run.html` references a local file the HAR didn't capture, and when the page calls
  `window.claude.*` (runtime capabilities such as db, assets or ask, which can't work standalone).

## Instructions

1. **Ask Michael for the capture.** He opens the artifact in his browser with HTTP Toolkit
   intercepting (proven), lets it load fully, clicks into any screens that lazy-load files, and
   saves a HAR. A Chrome DevTools Network export should also work but is untested.
2. **Inventory it safely:** `anima skills run extracting-claude-artifacts list /abs/path/capture.har`.
   Check that a page entry exists and has a body. Several versions means several loads; pick with `--version`.
3. **Extract into the current project's `tmp/`** (it survives reboots; the scratchpad doesn't):
   `anima skills run extracting-claude-artifacts extract /abs/path/capture.har /abs/project/tmp/<name>`
4. **Serve it** from that folder, in the background, bound to localhost:
   `python3 -I -m http.server <port> --bind 127.0.0.1`, then open `http://127.0.0.1:<port>/run.html`.
5. **Drive it** with DOMINATRIX (`controlling-the-browser`) or agent-browser (`browsing-the-web`);
   everything is readable and clickable now. Read the inline `<script>` directly for data and logic.
6. **Write a short README** in the folder: source link, who made it, capture date, and how to run it.
7. **Clean up:** stop the server, and ask Michael to approve deleting the HAR.

## Safety

- **A HAR holds Michael's session cookies and auth headers.** Never print, grep out or copy headers,
  and never commit a HAR or put it anywhere shared. The scripts only print URLs without query
  strings (frame tokens live there), statuses, types and sizes.
- Delete the HAR once the extraction is verified (with Michael's OK).
- The extracted folder is a teammate's work: keep it in `tmp/`, don't publish or commit it.

## Example

A teammate's granular-permissions prototype, Oct 26:
`~/Projects/beehiiv/swarm/tmp/plans/granular-permissions/sources/prototype-oct23/`
(`index.html`, `run.html`, the inline script saved as `prototype.js`, `blossom-kit.js`, and a README).
The scripts reproduce that hand extraction byte for byte.
