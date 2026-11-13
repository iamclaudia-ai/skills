#!/usr/bin/env bun
/**
 * Keep Michael's /today note in step with the live board during the day. The board keeps itself
 * current: its top 5 is the morning's ranked queue minus whatever got done or started waiting,
 * topped up from the board's own ranking. So this never re-picks just because picks got done. A
 * scheduler task runs it every 30 minutes on weekdays, 8am to 6pm; most runs only read
 * `today board` and exit. When the note has fallen behind, it starts one short session that
 * follows references/day-refresh.md (no Slack scan), then checks a new note landed.
 *
 * Never within an hour of the last note. Then:
 *   - rerank: the queue ran low (fewer than 5 of its items still his to act on, and the board
 *     is filling picks from its own ranking) and something moved since the note: write a new
 *     ranked queue and a note.
 *   - note: the picks the note was written over (`notePicks`) have moved on: 3 or more of them
 *     (or all, when there were fewer), or any one once the note is 2+ hours old, or new work
 *     arrived on a board the note called empty. Write a fresh note; leave the queue alone.
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
const TOP = 5;

/** One line of `today board` (anima's extensions/today/src/board.ts). */
export interface BoardLine {
  key: string;
  title: string;
  lane: string;
  says: string[];
  /** Every PR's key when the line is a stack, bottom first. */
  stack?: string[];
}

export interface Board {
  date: string;
  picks: Array<BoardLine & { fromQueue: boolean; reason: string | null }>;
  waiting: Array<BoardLine & { nudgeDue: boolean }>;
  asking: Array<{ key: string; title: string; question: string }>;
  queue: { open: number; moving: number };
  noteUpdatedAt: string | null;
  /** The live picks when the note was written; null for a note older than that record. */
  notePicks: string[] | null;
}

export type Mode = "note" | "rerank";

/** The note's picks that aren't in the live top 5 any more (done, waiting, or crowded out). */
export function movedOn(board: Pick<Board, "picks" | "notePicks">): string[] {
  const live = new Set(board.picks.flatMap((p) => [p.key, ...(p.stack ?? [])]));
  return (board.notePicks ?? []).filter((key) => !live.has(key));
}

export function decide(input: { now: Date; board: Board }): {
  refresh: boolean;
  mode?: Mode;
  reason: string;
} {
  const { now, board } = input;
  const day = now.getDay();
  const hour = now.getHours();
  if (day === 0 || day === 6 || hour < 8 || hour >= 18) {
    return { refresh: false, reason: "outside weekday hours (8am-6pm)" };
  }
  if (!board.noteUpdatedAt) {
    return { refresh: false, reason: "no note yet today: the morning sweep writes the first" };
  }
  const ageMin = Math.floor((now.getTime() - Date.parse(board.noteUpdatedAt)) / 60_000);
  if (ageMin < MIN_GAP_MIN) return { refresh: false, reason: `note is only ${ageMin} min old` };

  const noted = board.notePicks ?? [];
  const moved = movedOn(board).length;
  const borrowed = board.picks.filter((p) => !p.fromQueue).length;
  if (board.queue.moving < TOP && borrowed > 0 && moved > 0) {
    return {
      refresh: true,
      mode: "rerank",
      reason: `only ${board.queue.moving} of the morning's queue still his to act on, and ${borrowed} of the picks come from the board's own ranking`,
    };
  }
  if (moved > 0 && moved >= Math.min(3, noted.length)) {
    return {
      refresh: true,
      mode: "note",
      reason: `${moved} of the ${noted.length} picks the note talks about have moved on`,
    };
  }
  if (moved > 0 && ageMin >= STALE_MIN) {
    return {
      refresh: true,
      mode: "note",
      reason: `the note is ${Math.floor(ageMin / 60)}h old and ${moved} of its picks have moved on`,
    };
  }
  if (board.notePicks !== null && noted.length === 0 && board.picks.length > 0) {
    return { refresh: true, mode: "note", reason: "new work arrived since a note with no picks" };
  }
  return {
    refresh: false,
    reason: `${moved} of ${noted.length} noted picks moved on, note ${ageMin} min old`,
  };
}

function anima(args: string[], timeoutMs = 60_000): unknown {
  const res = Bun.spawnSync([ANIMA, ...args], { stderr: "pipe", timeout: timeoutMs });
  if (!res.success) throw new Error(`anima ${args.slice(0, 2).join(" ")}: ${res.stderr.toString().trim()}`);
  return JSON.parse(res.stdout.toString());
}

interface ListItem {
  key: string;
  title: string;
  status: string;
  completedAt: string | null;
}

const lineText = (l: BoardLine) => `- ${l.key}: ${l.title}${l.says.length ? ` (${l.says.join("; ")})` : ""}`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  const board = anima(["today", "board"]) as Board;
  const verdict = decide({ now: new Date(), board });
  if (!verdict.refresh && !force) {
    console.log(`no refresh: ${verdict.reason}`);
    process.exit(0);
  }
  const mode: Mode = verdict.mode ?? "note";

  // `today list` returns only open items unless asked: what he finished would vanish.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const since = board.noteUpdatedAt ?? midnight.toISOString();
  const list = anima(["today", "list", "--doneSince", since]) as { items: ListItem[] };
  const finished = list.items.filter((i) => i.status !== "open" && (i.completedAt ?? "") >= since);
  const waiting = new Set(board.waiting.flatMap((w) => [w.key, ...(w.stack ?? [])]));
  const fate = (key: string) => {
    const item = list.items.find((i) => i.key === key);
    if (item && item.status !== "open") return item.status;
    return waiting.has(key) ? "waiting on someone else now" : "crowded out of the top 5";
  };
  const live = new Set(board.picks.flatMap((p) => [p.key, ...(p.stack ?? [])]));

  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const prompt = [
    `Load the tracking-slack-promises skill and refresh Michael's /today ${mode === "rerank" ? "queue and note" : "note"} exactly as`,
    `${RUNBOOK} describes (mode: ${mode}).`,
    "",
    `Date: ${board.date}, ${time}. Why now: ${force && !verdict.refresh ? "a manual run" : verdict.reason}.`,
    "",
    "The picks the current note talks about, and where they went:",
    ...((board.notePicks ?? []).length
      ? (board.notePicks ?? []).map((key) => `- ${key}: ${live.has(key) ? "still a pick" : fate(key)}`)
      : ["- none recorded"]),
    "",
    "Finished since the note:",
    ...(finished.length ? finished.map((i) => `- ${i.key}: ${i.title} (${i.status})`) : ["- nothing yet"]),
    "",
    "The live top picks now:",
    ...(board.picks.length ? board.picks.map(lineText) : ["- none"]),
    "",
    "Waiting on others:",
    ...(board.waiting.length
      ? board.waiting.map((w) => `${lineText(w)}${w.nudgeDue ? " [nudge due]" : ""}`)
      : ["- none"]),
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
  console.log(`started today refresh (${mode}) ${sessionId}: ${verdict.reason}`);

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

  const after = anima(["today", "board"]) as Board;
  if (!after.noteUpdatedAt || after.noteUpdatedAt < startedAt) {
    console.error(`today refresh ${sessionId}: no new note (last written ${after.noteUpdatedAt})`);
    process.exit(1);
  }
  console.log(`today refresh done (${sessionId})`);
}
