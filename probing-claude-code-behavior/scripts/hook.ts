/**
 * Probe hook (probing-claude-code-behavior skill). Events go to $PROBE_EVENTS. Registered for PermissionRequest, PermissionDenied and
 * Notification. Logs every call to events.jsonl; for PermissionRequest it can
 * wait PROBE_WAIT seconds and then answer per PROBE_MODE:
 *   log   → exit 0, no output (no decision)
 *   allow → {"behavior":"allow"}
 *   deny  → {"behavior":"deny","message":"..."}
 */
import { appendFileSync } from "node:fs";

const eventsPath = process.env.PROBE_EVENTS ?? "/dev/null";
const started = Date.now();
const log = (o: Record<string, unknown>): void =>
  appendFileSync(
    eventsPath,
    `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, ...o })}\n`,
  );

const raw = await Bun.stdin.text();
const input = JSON.parse(raw) as Record<string, unknown>;
const event = String(input.hook_event_name);
const mode = process.env.PROBE_MODE ?? "log";
const wait = Number(process.env.PROBE_WAIT ?? 0);

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => {
    log({ event, phase: "signal", sig, afterMs: Date.now() - started });
    process.exit(0);
  });
}

if (event === "PreToolUse") {
  // Stand-in for dcg's warn tier: ask for confirmation on the marker command.
  const command = String((input.tool_input as { command?: string } | undefined)?.command ?? "");
  if (command.includes("ask-me")) {
    log({ event, phase: "ask", command: command.slice(0, 120) });
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "The probe asks before running this",
        },
      }),
    );
  }
  process.exit(0);
}

log({ event, phase: "start", mode, wait, input });
if (event !== "PermissionRequest") process.exit(0);

if (wait > 0) await Bun.sleep(wait * 1000);

let out: unknown;
if (mode === "allow") {
  out = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
} else if (mode === "deny") {
  out = {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "deny", message: "Denied by the probe hook" },
    },
  };
}
log({ event, phase: "end", afterMs: Date.now() - started, out });
if (out) process.stdout.write(JSON.stringify(out));
process.exit(0);
