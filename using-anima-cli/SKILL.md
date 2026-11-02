---
name: using-anima-cli
description: "Use PROACTIVELY when interacting with the Anima platform — managing extensions, memory, sessions, gateway, watchdog, or any Anima service. The anima CLI is the primary interface for all platform operations. NEVER use curl to API endpoints when the CLI is available. Triggers on: anima, memory process, restart extension, gateway, watchdog, list sessions, send prompt, handoff, hand off, new session instead of compacting, continue in a new session, context getting full, memory status, queue conversations, process conversation, ingest, health check, anima CLI, extension methods."
---

# Using the Anima CLI

The `anima` CLI is the primary interface to the Anima platform. **Always use it instead of curl/API calls.**

## When to Use

- Any time you need to interact with Anima's extensions (memory, session, gateway, etc.)
- Managing the watchdog (restart services, check status, view logs)
- Processing memories, queuing conversations, checking transcripts
- Creating/managing sessions and workspaces
- Restarting extensions after code changes

## Command Structure

```bash
anima <namespace> <action> [--param value]
```

**Namespaces:** codex, control, gateway, hooks, imessage, memory, session, watchdog

**Help:** `anima <namespace> --help` or `anima methods [namespace]`

## Common Commands

### Memory (Libby)

```bash
# Queue conversations for Libby to process
anima memory process --batchSize 30

# Check conversation statuses
anima memory conversations --status archived --limit 10
anima memory conversations --status review
anima memory conversations --status queued

# Process a specific conversation
anima memory process_conversation --id 2349

# Get a formatted transcript
anima memory get_transcript --id 2349

# Re-ingest session files
anima memory ingest --dir ~/.claude/projects

# Health check
anima memory health_check
```

### Gateway

```bash
# Restart an extension (after code changes)
anima gateway restart_extension --extension memory
anima gateway restart_extension --extension voice
anima gateway restart_extension --extension session

# List loaded extensions
anima gateway list_extensions

# List all available methods
anima gateway list_methods
```

### Watchdog

```bash
# Check service status (watchdog's view: gateway + agent-host processes)
anima watchdog status

# Full system health — gateway /health aggregate: every extension's ok/error,
# stale process locks, web client beacon. Token handled automatically.
# NEVER curl http://localhost:30086/health — this is the command for that.
anima watchdog health_check
anima watchdog health_check --json   # raw payload

# Restart a service
anima watchdog restart --service gateway
anima watchdog restart --service runtime

# View logs
anima watchdog logs
anima watchdog log_tail --file gateway --lines 50
```

**Mental model:** watchdog is the bare-minimum runtime (must always work; supervises everything else); gateway loads extensions and tracks their health. So `watchdog status` = "are the services up?", `watchdog health_check` = "is the whole system healthy, extension by extension?"

### Session

```bash
# List sessions for a workspace
anima session list_sessions --cwd /path/to/project

# Get session info
anima session get_info --sessionId abc-123

# List workspaces
anima session list_workspaces
```

### Handing off to a new session (instead of compacting)

When my context is getting full on long work, or a phase is done and the next one deserves a clean
start, I hand off myself — no need to ask Michael to open a session and paste a prompt:

```bash
# 1. Write the handoff prompt: what to read first (NOTES.md / the plan's "Start here"), what's
#    done, what's next, and any hard-won facts the new session must not re-learn.
# 2. Hand off. sessionId comes from $ANIMA_SESSION_ID; folder, agent, model and profile are mine.
anima session handoff --title "M7: ENT-754 roles" --promptFile tmp/m7/HANDOFF.md
#    (--prompt "..." works for short ones; --targetCwd / --model / --profile override)
```

- Returns the new `sessionId` right away (no streaming). The new session is already working.
- Michael's web chat showing my session jumps to the new one by itself; a tab showing a different
  session stays put. iOS voice mode sends its next prompt to the new one.
- My session is marked resolved and links forward; the new one links back and its first message
  names my session id, so it can `anima session get_history --sessionId <mine>` if it needs more.
- A session hands off **once**. After it succeeds, finish the turn with a one-line pointer to the
  new session and stop working here.

## Notes

- The CLI connects to the gateway via WebSocket (ws://localhost:30086/ws)
- All extension methods are automatically exposed as CLI commands
- Output is JSON by default
- After editing extension source files, HMR usually picks up changes automatically — use `anima gateway restart_extension` if it doesn't
- The watchdog manages gateway and runtime as child processes on port 30085
