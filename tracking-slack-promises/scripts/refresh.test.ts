import { describe, expect, test } from "bun:test";
import { type Board, decide, movedOn } from "./refresh";

// Friday Nov 13, 2026, local time.
const at = (hhmm: string) => new Date(`2026-11-13T${hhmm}:00`);
const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

const pick = (key: string, fromQueue = true) => ({
  key,
  title: key,
  lane: "actionable",
  says: [],
  fromQueue,
  reason: null,
});

function board(more: Partial<Board> & { live?: string[]; borrowed?: string[] }): Board {
  const { live = ["a", "b", "c", "d", "e"], borrowed = [], ...rest } = more;
  return {
    date: "2026-11-13",
    picks: [...live.map((k) => pick(k)), ...borrowed.map((k) => pick(k, false))],
    waiting: [],
    asking: [],
    queue: { open: 12, moving: 9 },
    noteUpdatedAt: null,
    notePicks: ["a", "b", "c", "d", "e"],
    ...rest,
  };
}

describe("decide", () => {
  test("a fresh note once 3 of the picks it talks about have moved on; the queue stays", () => {
    const now = at("11:00");
    const verdict = decide({
      now,
      board: board({ noteUpdatedAt: ago(now, 70), live: ["d", "e", "f", "g", "h"] }),
    });
    expect(verdict).toEqual({
      refresh: true,
      mode: "note",
      reason: "3 of the 5 picks the note talks about have moved on",
    });
  });

  test("one moved on is enough once the note is 2h old; none never is", () => {
    const now = at("14:00");
    const oneMoved = board({ noteUpdatedAt: ago(now, 150), live: ["b", "c", "d", "e", "f"] });
    expect(decide({ now, board: oneMoved })).toMatchObject({ refresh: true, mode: "note" });
    expect(decide({ now, board: board({ noteUpdatedAt: ago(now, 300) }) }).refresh).toBe(false);
  });

  test("a short note's picks count all at once: both of two gone is a lot", () => {
    const now = at("11:00");
    const verdict = decide({
      now,
      board: board({ noteUpdatedAt: ago(now, 70), notePicks: ["a", "b"], live: ["c"] }),
    });
    expect(verdict).toMatchObject({ refresh: true, mode: "note" });
  });

  test("the queue running low, with the board borrowing picks, asks for a new ranking", () => {
    const now = at("15:00");
    const verdict = decide({
      now,
      board: board({
        noteUpdatedAt: ago(now, 70),
        live: ["c"],
        borrowed: ["x", "y"],
        queue: { open: 6, moving: 1 },
      }),
    });
    expect(verdict).toMatchObject({ refresh: true, mode: "rerank" });
    expect(verdict.reason).toContain("only 1 of the morning's queue");
  });

  test("a stack counts as still picked through any of its PRs", () => {
    const b = board({ notePicks: ["pr:1", "pr:2"], live: [] });
    b.picks = [{ ...pick("pr:3"), stack: ["pr:1", "pr:2", "pr:3"] }];
    expect(movedOn(b)).toEqual([]);
  });

  test("new work on a board the note called empty", () => {
    const now = at("11:00");
    const verdict = decide({ now, board: board({ noteUpdatedAt: ago(now, 70), notePicks: [] }) });
    expect(verdict).toMatchObject({ refresh: true, mode: "note" });
  });

  test("never within an hour of the last note", () => {
    const now = at("11:00");
    expect(decide({ now, board: board({ noteUpdatedAt: ago(now, 45), live: [] }) })).toMatchObject({
      refresh: false,
      reason: "note is only 45 min old",
    });
  });

  test("only on weekdays, 8am to 6pm", () => {
    const old = (now: Date) => ({ now, board: board({ noteUpdatedAt: ago(now, 300), live: [] }) });
    expect(decide(old(at("07:59"))).refresh).toBe(false);
    expect(decide(old(at("18:00"))).refresh).toBe(false);
    expect(decide(old(new Date("2026-11-14T12:00:00"))).refresh).toBe(false); // Saturday
    expect(decide(old(at("08:00"))).refresh).toBe(true);
  });

  test("no note yet: the morning sweep hasn't run", () => {
    expect(decide({ now: at("11:00"), board: board({}) }).refresh).toBe(false);
  });

  test("a note from before notePicks was recorded is left alone", () => {
    const now = at("11:00");
    const verdict = decide({ now, board: board({ noteUpdatedAt: ago(now, 200), notePicks: null }) });
    expect(verdict.refresh).toBe(false);
  });
});
