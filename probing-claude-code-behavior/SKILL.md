---
name: probing-claude-code-behavior
description: "MUST be used when you need to find out how the real Claude Code CLI behaves rather than guess: how a hook event fires (PermissionRequest, PreToolUse ask, Notification, PermissionDenied), what its input carries, what a hook's reply does, how a permission dialog or countdown renders in the TUI, or what a minified binary string says. Runs a throwaway `claude` in a detached tmux pane with hooks added through --settings, snapshots the pane every second, logs every hook call, and searches the CLI binary's strings without hanging. Covers the traps: the trust dialog defaulting to No, my own Bash line tripping the rm safety check, tokf rewriting paths to '.', grep hanging on minified lines. Triggers on: how does Claude Code handle, does the hook fire, PermissionRequest hook, hook input fields, hook decision schema, permission dialog, auto-deny countdown, automatically block this request, unattended session, spike claude code, test a hook, claude --settings, capture-pane claude, TUI behavior, what does the CLI do when, search the claude binary, minified string, Claude Code version change broke scraping."
---

# Probing Claude Code Behavior

Measure what the CLI actually does instead of designing around a guess. #83's countdown fix in
Anima was built on a guessed wording ("deny") and broke because the CLI says "block". The
spikes in anima #84 answered every hook question in one afternoon with this kit.

## When to Use

- Before building on a hook event: does it fire for this case, what's in its input, what does
  its reply do, what happens when it times out or the user answers in the terminal?
- When something that reads the TUI (Anima's modal scraper) breaks after a CLI update.
- When you need the exact text or schema the CLI uses (dialog wording, decision fields).

## The Kit (`scripts/`)

- **`run.ts`**: launches `claude` (haiku) in a detached 220x50 tmux pane in a scratch folder,
  with `hook.ts` added through `--settings` for PermissionRequest, PermissionDenied,
  Notification and PreToolUse. Sends one prompt, snapshots the pane once a second (dialog on
  screen? countdown?), then reports whether the command ran and every hook call.
  ```bash
  bun ~/.claude/skills/probing-claude-code-behavior/scripts/run.ts \
    --out ./tmp/cc-probe --prompt-file ./tmp/cc-probe/prompt.txt \
    --mode allow --wait 10 --secs 30 [--timeout 12] [--answer 2@9] [--default]
  ```
  - `--mode log|allow|deny`: what the PermissionRequest hook replies, after `--wait` seconds.
  - `--timeout N`: the hook's own timeout in settings. `--answer K@S`: press key K in the pane at
    second S (a person answering in the terminal). `--default`: drop `--dangerously-skip-permissions`.
  - A Bash command containing `ask-me` gets a PreToolUse `ask` (stands in for dcg's warn tier).
  - The prompt should make it append to `ran.log` in the scratch folder: that's how "did it run" is told.
  - Output: `<out>/runs/<label>.log`, hook calls in `<out>/events.jsonl`.
- **`hook.ts`**: the hook itself (logs input, waits, replies; logs SIGTERM).
- **`ctx.py`**: context search in a strings dump of the CLI binary:
  ```bash
  strings "$(readlink -f "$(which claude)")" > ./tmp/cc-probe/strings.txt
  python3 -I ~/.claude/skills/probing-claude-code-behavior/scripts/ctx.py ./tmp/cc-probe/strings.txt 250 'autoDenyAfterMs'
  ```

## Traps

- **My own Bash line must never contain a removal or an inline shell script**, not even as text
  in a heredoc, a quoted note, or a prompt argument. Claude Code's safety check parses the whole
  line and blocks it (it also popped a dialog in Michael's web UI). Put prompts in files
  (`--prompt-file`), write notes with the Write tool.
- **The trust dialog in a new folder defaults to "No, exit"**: Enter quits `claude`. `run.ts`
  sends Down then Enter. A scratch folder under an already-trusted project usually skips it,
  unless it is its own git repo.
- **tokf rewrites the project path to `.` in everything I see**, even `/bin/pwd` and `cat` of a
  file. Paths that look relative may be absolute. Check with
  `python3 -c "import os; print(os.path.isabs(p))"` rather than by reading output.
- **grep with `.{0,N}` on the strings dump hangs** (minified lines are thousands of characters;
  `{256,}` is also an error). Use `ctx.py`.
- dcg's rules change: `git branch -f` used to ask, now it blocks outright. Use the `ask-me`
  stand-in instead of relying on a dcg rule to produce an ask.
- Never send keys into a pane you didn't start (Anima sessions). Only `claudia-probe-*` panes.

## Measured: Claude Code 2.1.322 (2026-11-11, anima #84)

| Question | Answer |
|---|---|
| PermissionRequest under `--dangerously-skip-permissions` | Fires for built-in safety checks and PreToolUse `ask` |
| Input keys | session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input, permission_suggestions. No reason text, no tool_use_id |
| Hook and dialog | Run in parallel; the dialog renders ~1-2s after the hook starts; first answer wins |
| Reply schema | `hookSpecificOutput.decision`: `{behavior:"allow", updatedInput?, updatedPermissions?}` or `{behavior:"deny", message, interrupt?}` |
| Answer in the terminal while the hook waits | Hook gets SIGTERM immediately |
| Hook `timeout` expires | SIGTERM; dialog stays |
| Unattended countdown (2:00, safety checks only) expires | Call blocked; hook gets no signal; no PermissionDenied |
| Countdown text | `⚠ Claude Code will automatically block this request in 1:34, to avoid holding up an unattended session` |
| Auto mode | The CLI ignores a hook's allow |
| Notification hook | `notification_type: "permission_prompt"`, ~6s after the request |

Re-measure after CLI updates that touch permissions; update this table with the version.

## Measured: workspace trust, Claude Code 2.1.323 (2026-11-13)

How the "Is this a project you trust?" dialog decides, measured with a throwaway repo under
`~/Projects` launched in a tmux pane (`claude --dangerously-skip-permissions`), then read in the
binary (`pL`, `bS`, `SS` near `hasTrustDialogAccepted`).

| Question | Answer |
|---|---|
| Shows under `--dangerously-skip-permissions`? | Yes. Every profile needs its folder trusted |
| Key it reads | `projects[<realpath of cwd>].hasTrustDialogAccepted === true` in `~/.claude.json` |
| Minimal entry | `{ "hasTrustDialogAccepted": true }` alone is enough |
| Parent folders | Walks up from cwd, but **never past the git root**: a trusted `~/Projects` covers no repo inside it |
| Subfolder of a trusted repo | Trusted (the walk reaches the repo root) |
| Worktree of a trusted repo | Trusted (the main repo's entry counts) |
| Home folder | Trust is session-only, never read from the file |

Anima pre-trusts every CLI session's cwd before launch:
`packages/agent-host/src/providers/cli/workspace-trust.ts`. To probe a binary string without grep
choking on minified lines, read the binary in bun (`TextDecoder("latin1")`, `indexOf`, slice
around the hit); dcg blocks `perl` in a pipeline.
