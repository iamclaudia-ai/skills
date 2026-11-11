/**
 * Probe runner (probing-claude-code-behavior skill).
 *
 *   bun run.ts --out <dir> --prompt-file <file> [--mode log|allow|deny] [--wait N]
 *              [--timeout N] [--secs N] [--answer K@S] [--default]
 *
 * Launches a throwaway `claude` (haiku) in a detached 220x50 tmux pane in
 * <out>/work, with hook.ts added through --settings, sends the prompt, snapshots
 * the pane once a second, then writes <out>/runs/<label>.log: what the pane
 * showed, whether the command ran (a new line in <out>/work/ran.log), and every
 * hook call. Never touches a pane it didn't start.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string, dflt = ""): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? dflt) : dflt;
};
const outArg = flag("out");
const promptFile = flag("prompt-file");
if (!outArg || !promptFile) {
  console.error("usage: bun run.ts --out <dir> --prompt-file <file> [--mode log|allow|deny] …");
  process.exit(2);
}
const mode = flag("mode", "log");
const wait = Number(flag("wait", "0"));
const timeout = flag("timeout");
const secs = Number(flag("secs", "40"));
const answer = flag("answer");
const permFlag = args.includes("--default") ? [] : ["--dangerously-skip-permissions"];

mkdirSync(outArg, { recursive: true });
const out = realpathSync(outArg);
const work = join(out, "work");
mkdirSync(work, { recursive: true });
const hookScript = join(realpathSync(import.meta.dir), "hook.ts");
const eventsPath = join(out, "events.jsonl");
const prompt = readFileSync(promptFile, "utf8").trim();
const label = `${mode}-w${wait}${timeout ? `-t${timeout}` : ""}${answer ? `-a${answer}` : ""}${permFlag.length ? "" : "-default"}-${Date.now()}`;

const hook = (withTimeout: boolean) => ({
  type: "command",
  command: `'${process.execPath}' '${hookScript}'`,
  ...(withTimeout && timeout ? { timeout: Number(timeout) } : {}),
});
const settingsPath = join(out, "settings.json");
writeFileSync(
  settingsPath,
  JSON.stringify(
    {
      hooks: {
        PermissionRequest: [{ matcher: "*", hooks: [hook(true)] }],
        PermissionDenied: [{ matcher: "*", hooks: [hook(false)] }],
        PreToolUse: [{ matcher: "Bash", hooks: [hook(false)] }],
        Notification: [{ hooks: [hook(false)] }],
      },
    },
    null,
    2,
  ),
);

const tmux = (...a: string[]): string => {
  try {
    return execFileSync("tmux", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? "");
  }
};
const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const name = "claudia-probe";
tmux("kill-session", "-t", name);
const cmd = [
  `PROBE_MODE=${mode}`,
  `PROBE_WAIT=${wait}`,
  `PROBE_EVENTS=${sq(eventsPath)}`,
  "claude",
  "--model",
  "haiku",
  ...permFlag,
  "--settings",
  sq(settingsPath),
  sq(prompt),
].join(" ");
const ranLog = join(work, "ran.log");
const lines = (p: string): number => (existsSync(p) ? readFileSync(p, "utf8").split("\n").length : 0);
const before = lines(ranLog);
tmux("new-session", "-d", "-s", name, "-x", "220", "-y", "50", "-c", work, cmd);

/** A dialog is on screen: its footer sits in the last few non-blank lines. */
const dialogOnScreen = (pane: string): boolean =>
  pane
    .split("\n")
    .filter((l) => l.trim())
    .slice(-4)
    .some((l) => /Esc to cancel|Enter to confirm|Enter to select/.test(l));
const countdown = (pane: string): string =>
  /automatically \w+ this request in\s+(\d+:\d{2})/.exec(pane.replace(/\n/g, " "))?.[1] ?? "-";

const log: string[] = [`# ${label}  ${new Date().toISOString()}`, `cmd: ${cmd}`, ""];
const t0 = Date.now();
let last = "";
let answered = false;
const [ansKey, ansAt] = answer ? answer.split("@") : ["", ""];
for (let s = 0; s < secs; s++) {
  await Bun.sleep(1000);
  const pane = tmux("capture-pane", "-t", name, "-p");
  if (/Is this a project you created|trust this folder/i.test(pane)) {
    // Defaults to "No, exit".
    tmux("send-keys", "-t", name, "Down");
    await Bun.sleep(300);
    tmux("send-keys", "-t", name, "Enter");
    log.push(`[${s}s] trust dialog → Down, Enter`);
    continue;
  }
  if (answer && !answered && s >= Number(ansAt)) {
    tmux("send-keys", "-t", name, ansKey!);
    answered = true;
    log.push(`[${s}s] pressed ${ansKey} in the pane`);
  }
  const sig = dialogOnScreen(pane) ? `DIALOG countdown=${countdown(pane)}` : "no dialog";
  if (sig !== last) log.push(`[${s}s] ${sig}`);
  last = sig;
}
log.push("", "--- final pane ---", tmux("capture-pane", "-t", name, "-p").trimEnd());
tmux("kill-session", "-t", name);
log.push("", `COMMAND RAN: ${lines(ranLog) > before ? "yes" : "no"}`, "", "--- hook calls ---");
if (existsSync(eventsPath)) {
  for (const line of readFileSync(eventsPath, "utf8").trim().split("\n")) {
    const e = JSON.parse(line) as Record<string, unknown>;
    if (Date.parse(String(e.t)) < t0) continue;
    const { input, ...rest } = e;
    const i = (input ?? {}) as Record<string, unknown>;
    log.push(
      JSON.stringify({
        ...rest,
        ...(input
          ? {
              tool: i.tool_name,
              notification_type: i.notification_type,
              keys: Object.keys(i).join(","),
              tool_input: JSON.stringify(i.tool_input ?? null).slice(0, 160),
            }
          : {}),
      }),
    );
  }
}
mkdirSync(join(out, "runs"), { recursive: true });
writeFileSync(join(out, "runs", `${label}.log`), log.join("\n"));
console.log(log.join("\n"));
