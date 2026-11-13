import { describe, expect, test } from "bun:test";
import { decide, type Pick } from "./refresh";

// Thursday Nov 12, 2026, local time.
const at = (hhmm: string) => new Date(`2026-11-12T${hhmm}:00`);
const ago = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const picks = (...statuses: string[]): Pick[] =>
  statuses.map((status, i) => ({ key: `linear:BEE-${i}`, title: `Pick ${i}`, status }));

describe("decide", () => {
  test("refreshes once every pick is done", () => {
    const now = at("11:00");
    expect(decide({ now, noteUpdatedAt: ago(now, 90), picks: picks("done", "done", "dismissed") })).toEqual({
      refresh: true,
      reason: "all 3 top picks are done",
    });
  });

  test("refreshes a 2h-old note once something is done", () => {
    const now = at("14:00");
    const verdict = decide({ now, noteUpdatedAt: ago(now, 150), picks: picks("done", "open", "open") });
    expect(verdict).toEqual({ refresh: true, reason: "the note is 2h old and 1 of 3 picks are done" });
  });

  test("leaves an old note alone when nothing is done: it's still true", () => {
    const now = at("14:00");
    expect(decide({ now, noteUpdatedAt: ago(now, 300), picks: picks("open", "open") }).refresh).toBe(false);
  });

  test("never within an hour of the last note", () => {
    const now = at("11:00");
    expect(decide({ now, noteUpdatedAt: ago(now, 45), picks: picks("done") })).toMatchObject({
      refresh: false,
      reason: "note is only 45 min old",
    });
  });

  test("only on weekdays, 8am to 6pm", () => {
    const old = (now: Date) => ({ now, noteUpdatedAt: ago(now, 300), picks: picks("done") });
    expect(decide(old(at("07:59"))).refresh).toBe(false);
    expect(decide(old(at("18:00"))).refresh).toBe(false);
    expect(decide(old(new Date("2026-11-14T12:00:00"))).refresh).toBe(false); // Saturday
    expect(decide(old(at("08:00"))).refresh).toBe(true);
  });

  test("no note or no picks: the morning sweep hasn't run, nothing to refresh", () => {
    const now = at("11:00");
    expect(decide({ now, noteUpdatedAt: null, picks: picks("done") }).refresh).toBe(false);
    expect(decide({ now, noteUpdatedAt: ago(now, 300), picks: [] }).refresh).toBe(false);
  });
});
