#!/usr/bin/env bun
/**
 * Refresh Michael's /today note and top picks during the day, once he has got through the
 * morning's. A scheduler task runs this every 30 minutes on weekdays, 8am to 6pm. Most runs
 * only read the board and exit; a refresh starts one short session that follows
 * references/day-refresh.md (no Slack scan), then checks a new note landed.
 *
 * Refresh when (and never within an hour of the last note):
 *   - every one of today's top picks is done, or
 *   - the note is 2+ hours old and at least one pick is done.
 * A pick he nudged today counts as done: its PR waits on reviewers now, not on him.
 *
 *   refresh.ts [--dry-run] [--force]
 */

import { homedir } from "node:os";
import { join } from "node:path";

const ANIMA = Bun.which("anima") ?? join(homedir(), ".bun", "bin", "anima");
const SWARM = join(homedir(), "Projects/beehiiv/swarm");
const RUNBOOK = join(import.meta.dir, "../references/day-refresh.md");
const PROFILE = "sweep"; // the morning sweep's profile; the runbook forbids Slack posts
const MAX_WAIT_MS = 30 * 60 * 1000;
const MIN_GAP_MIN = 60;
const STALE_MIN = 120;

export interface Pick {
  key: string;
  title: string;
  status: string;
  /** When he last bumped its reviewers in Slack from the board (`today.nudge`). */
  nudgedAt?: string | null;
}

/** Done, dismissed, or a PR he nudged today: either way, nothing left for him today. */
export function handled(pick: Pick, now: Date): boolean {
  if (pick.status !== "open") return true;
  if (!pick.nudgedAt) return false;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Date.parse(pick.nudgedAt) >= midnight.getTime();
}

export function decide(input: {
  now: Date;
  noteUpdatedAt: string | null;
  picks: Pick[];
}): { refresh: boolean; reason: string } {
  const { now, noteUpdatedAt, picks } = input;
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 0 || day === 6 || hour < 8 || hour >= 18) {
    return { refresh: false, reason: "outside weekday hours (8am-6pm)" };
  }
  if (!noteUpdatedAt) return { refresh: false, reason: "no note yet today: the morning sweep writes the first" };
  const ageMin = Math.floor((now.getTime() - Date.parse(noteUpdatedAt)) / 60_000);
  if (ageMin < MIN_GAP_MIN) return { refresh: false, reason: `note is only ${ageMin} min old` };
  if (picks.length === 0) return { refresh: false, reason: "no top picks today" };
  const done = picks.filter((p) => handled(p, now)).length;
  if (done === picks.length) return { refresh: true, reason: `all ${picks.length} top picks are done` };
  if (ageMin >= STALE_MIN && done > 0) {
    return {
      refresh: true,
      reason: `the note is ${Math.floor(ageMin / 60)}h old and ${done} of ${picks.length} picks are done`,
    };
  }
  return { refresh: false, reason: `${done} of ${picks.length} picks done, note ${ageMin} min old` };
}

function anima(args: string[], timeoutMs = 60_000): unknown {
  const res = Bun.spawnSync([ANIMA, ...args], { stderr: "pipe", timeout: timeoutMs });
  if (!res.success) throw new Error(`anima ${args.slice(0, 2).join(" ")}: ${res.stderr.toString().trim()}`);
  return JSON.parse(res.stdout.toString());
}

interface ListResponse {
  date: string;
  noteUpdatedAt: string | null;
  items: (Pick & { topDate: string | null; topRank: number | null })[];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  // `today list` returns only open items unless asked: finished picks would vanish, and "all picks
  // done" could never be seen (caught on the first end-to-end run).
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const board = anima(["today", "list", "--doneSince", midnight.toISOString()]) as ListResponse;
  const picks = board.items
    .filter((i) => i.topDate === board.date)
    .sort((a, b) => (a.topRank ?? 50) - (b.topRank ?? 50));
  const verdict = decide({ now: new Date(), noteUpdatedAt: board.noteUpdatedAt, picks });
  if (!verdict.refresh && !force) {
    console.log(`no refresh: ${verdict.reason}`);
    process.exit(0);
  }

  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const prompt = [
    "Load the tracking-slack-promises skill and refresh Michael's /today note and top picks exactly as",
    `${RUNBOOK} describes.`,
    "",
    `Date: ${board.date}, ${time}. Why now: ${force && !verdict.refresh ? "a manual run" : verdict.reason}.`,
    "Current top picks (the morning's, or the last refresh's):",
    ...picks.map((p) => `- ${p.key} (${p.status === "open" && handled(p, new Date()) ? "nudged today, waiting on reviewers" : p.status}): ${p.title}`),
    "",
    "You are running unattended. Never ask questions, never post in Slack, never change Linear.",
  ].join("\n");

  if (dryRun) {
    console.log(`would start "Today refresh · ${board.date} ${time}" in ${SWARM} (profile ${PROFILE}):\n\n${prompt}`);
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const { sessionId } = anima([
    "session", "spawn_agent", "--parentSessionId", "NEW", "--cwd", SWARM,
    "--name", `Today refresh · ${board.date} ${time}`, "--profile", PROFILE, "--prompt", prompt,
  ]) as { sessionId: string };
  console.log(`started today refresh ${sessionId}: ${verdict.reason}`);

  const turnActive = () =>
    Boolean(
      (anima(["session", "get_info", "--sessionId", sessionId]) as { session?: { turnActive?: boolean } })
        .session?.turnActive,
    );
  await Bun.sleep(30_000);
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      if (!turnActive()) break;
    } catch (error) {
      console.error(String(error));
    }
    await Bun.sleep(30_000);
  }

  const after = anima(["today", "list"]) as ListResponse;
  if (!after.noteUpdatedAt || after.noteUpdatedAt < startedAt) {
    console.error(`today refresh ${sessionId}: no new note (last written ${after.noteUpdatedAt})`);
    process.exit(1);
  }
  console.log(`today refresh done (${sessionId})`);
}
