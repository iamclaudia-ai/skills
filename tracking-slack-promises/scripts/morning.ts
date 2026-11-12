#!/usr/bin/env bun
/**
 * Start the morning sweep: one Claudia session in swarm that scans Slack since the last run, triages,
 * reconciles Michael's /today ticks into the ledger, sets the top picks and writes his note.
 * The session follows references/morning-sweep.md.
 *
 * Then it waits for the session's turn to end and checks the work landed (a scan today, a note for today),
 * exiting 1 otherwise, so the scheduler's failure alert reaches Michael before he opens an empty page.
 *
 *   morning.ts [--dry-run] [--no-wait]
 */

import { homedir } from "node:os";
import { join } from "node:path";

const ANIMA = Bun.which("anima") ?? join(homedir(), ".bun", "bin", "anima");
const SWARM = join(homedir(), "Projects/beehiiv/swarm");
const STATE = join(SWARM, "tmp/slack-promises");
const RUNBOOK = join(import.meta.dir, "../references/morning-sweep.md");
/** The `sweep` session profile: yolo with Slack's write tools removed (agentHost.sessionProfiles). */
const PROFILE = "sweep";
const MAX_WAIT_MS = 2 * 60 * 60 * 1000;

function anima(args: string[], timeoutMs = 60_000): unknown {
  const res = Bun.spawnSync([ANIMA, ...args], { stderr: "pipe", timeout: timeoutMs });
  if (!res.success) throw new Error(`anima ${args.slice(0, 2).join(" ")}: ${res.stderr.toString().trim()}`);
  return JSON.parse(res.stdout.toString());
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noWait = args.includes("--no-wait");

const date = new Date().toLocaleDateString("en-CA");
// A day of ticks plus slack for a late or missed run; recording an already-reconciled tick is skipped.
const doneSince = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();

const prompt = [
  "Load the tracking-slack-promises skill and run the morning sweep exactly as",
  `${RUNBOOK} describes, steps 1 to 7.`,
  "",
  `Date: ${date}. State dir: ${STATE}.`,
  `For step 3 use --doneSince ${doneSince}.`,
  "",
  "You are running unattended; Michael is asleep. Never ask questions, and never post to Slack.",
].join("\n");

if (dryRun) {
  console.log(`would start "Morning sweep · ${date}" in ${SWARM} (profile ${PROFILE}):\n\n${prompt}`);
  process.exit(0);
}

const { sessionId } = anima([
  "session", "spawn_agent", "--parentSessionId", "NEW", "--cwd", SWARM,
  "--name", `Morning sweep · ${date}`, "--profile", PROFILE, "--prompt", prompt,
]) as { sessionId: string };
console.log(`started morning sweep session ${sessionId}`);
if (noWait) process.exit(0);

const turnActive = () =>
  Boolean((anima(["session", "get_info", "--sessionId", sessionId]) as { session?: { turnActive?: boolean } })
    .session?.turnActive);

// Give the session time to report its turn before the first check.
await Bun.sleep(30_000);
const deadline = Date.now() + MAX_WAIT_MS;
while (Date.now() < deadline) {
  try {
    if (!turnActive()) break;
  } catch (error) {
    console.error(String(error));
  }
  await Bun.sleep(60_000);
}

const problems: string[] = [];
if (Date.now() >= deadline) problems.push("the session was still working after 2 hours");
const ledger = (await Bun.file(join(STATE, "ledger.json")).json()) as { last_scan?: string };
if (!ledger.last_scan?.startsWith(date)) problems.push(`no Slack scan today (last_scan ${ledger.last_scan})`);
const today = anima(["today", "list"]) as { date: string; note: string | null };
if (today.date !== date || !today.note) problems.push("no note on /today");

if (problems.length > 0) {
  console.error(`morning sweep ${sessionId}: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`morning sweep done: ${today.note}`);
