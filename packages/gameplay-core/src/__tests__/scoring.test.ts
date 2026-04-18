import { describe, it, expect, beforeEach } from "vitest";
import {
  ScoringEngine,
  PlayModeController,
  NoteWindowManager,
  DEFAULT_HIT_WINDOWS,
} from "../index.js";
import type { Chart } from "@spotifyhero/shared-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChart(noteTimes: number[]): Chart {
  return {
    trackId: "test-track",
    difficulty: "medium",
    bpm: 120,
    generatorVersion: "test",
    generatedAt: new Date(),
    notes: noteTimes.map((timeMs, lane) => ({
      timeMs,
      lane: lane % 4,
      durationMs: 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// ScoringEngine
// ---------------------------------------------------------------------------

describe("ScoringEngine", () => {
  let chart: Chart;
  let engine: ScoringEngine;

  beforeEach(() => {
    chart = makeChart([1000, 2000, 3000, 4000]);
    engine = new ScoringEngine(chart);
  });

  it("awards Perfect points for an on-time hit", () => {
    const event = engine.onNoteHit(0, 1000); // exactly on time
    expect(event).not.toBeNull();
    expect(event!.judgement).toBe("perfect");
    expect(event!.pointsAwarded).toBe(1000);
  });

  it("awards Great for a hit within the great window", () => {
    const event = engine.onNoteHit(0, 1000 + DEFAULT_HIT_WINDOWS.great - 5);
    expect(event!.judgement).toBe("great");
    expect(event!.pointsAwarded).toBe(750);
  });

  it("awards Good for a hit within the good window", () => {
    const event = engine.onNoteHit(0, 1000 + DEFAULT_HIT_WINDOWS.good - 5);
    expect(event!.judgement).toBe("good");
    expect(event!.pointsAwarded).toBe(400);
  });

  it("counts as Miss when hit time is beyond the bad window", () => {
    const event = engine.onNoteHit(0, 1000 + DEFAULT_HIT_WINDOWS.bad + 50);
    expect(event!.judgement).toBe("miss");
    expect(event!.pointsAwarded).toBe(0);
  });

  it("resets combo on miss", () => {
    engine.onNoteHit(0, 1000); // perfect
    engine.onNoteHit(1, 2000); // perfect → combo 2
    engine.onNoteHit(2, 9999); // miss → combo 0
    expect(engine.currentCombo).toBe(0);
  });

  it("increments combo on consecutive good+ hits", () => {
    engine.onNoteHit(0, 1000);
    engine.onNoteHit(1, 2000);
    engine.onNoteHit(2, 3000);
    expect(engine.currentCombo).toBe(3);
  });

  it("does not double-judge the same note", () => {
    engine.onNoteHit(0, 1000);
    const second = engine.onNoteHit(0, 1000);
    expect(second).toBeNull();
  });

  it("onNoteMissed records a miss event", () => {
    const event = engine.onNoteMissed(0);
    expect(event!.judgement).toBe("miss");
    expect(event!.pointsAwarded).toBe(0);
  });

  it("finalize returns accurate GameSession", () => {
    engine.onNoteHit(0, 1000); // perfect
    engine.onNoteHit(1, 2000); // perfect
    engine.onNoteMissed(2);
    engine.onNoteMissed(3);
    const session = engine.finalize("TestPlayer");
    expect(session.score).toBeGreaterThan(0);
    expect(session.playerName).toBe("TestPlayer");
    expect(session.accuracy).toBeLessThan(1);
    expect(session.judgements.perfect).toBe(2);
    expect(session.judgements.miss).toBe(2);
  });

  it("applies combo multiplier at combo ≥10", () => {
    // Build a chart with 11 notes
    const bigChart = makeChart(Array.from({ length: 11 }, (_, i) => (i + 1) * 1000));
    const bigEngine = new ScoringEngine(bigChart);
    for (let i = 0; i < 10; i++) {
      bigEngine.onNoteHit(i, (i + 1) * 1000);
    }
    // 11th note should get ×2 multiplier
    const event = bigEngine.onNoteHit(10, 11000);
    expect(event!.pointsAwarded).toBe(1000 * 2); // perfect × ×2
  });

  it("hold notes score sustain ticks without inflating perfect accuracy count", () => {
    const holdChart: Chart = {
      trackId: "hold-test",
      difficulty: "medium",
      bpm: 120,
      generatorVersion: "test",
      generatedAt: new Date(),
      notes: [{ timeMs: 1000, lane: 0, durationMs: 600 }],
    };
    const eng = new ScoringEngine(holdChart);
    eng.onNoteHit(0, 1000);
    const tickEvents = eng.advanceHolds(1000 + 600, [true, false, false, false]);
    expect(tickEvents.length).toBeGreaterThan(0);
    const session = eng.finalize();
    expect(session.judgements.perfect).toBe(1);
    expect(session.judgements.miss).toBe(0);
    expect(session.score).toBeGreaterThan(1000);
  });

  it("hold sustain ticks award points but do not increase combo", () => {
    const holdChart: Chart = {
      trackId: "hold-test",
      difficulty: "medium",
      bpm: 120,
      generatorVersion: "test",
      generatedAt: new Date(),
      notes: [{ timeMs: 1000, lane: 0, durationMs: 1200 }],
    };
    const eng = new ScoringEngine(holdChart);
    eng.onNoteHit(0, 1000);
    expect(eng.currentCombo).toBe(1);
    eng.advanceHolds(1400, [true, false, false, false]);
    expect(eng.currentCombo).toBe(1);
    eng.advanceHolds(2200, [true, false, false, false]);
    expect(eng.currentCombo).toBe(1);
    eng.advanceHolds(1000 + 1200, [true, false, false, false]);
    expect(eng.currentCombo).toBe(1);
  });

  it("chart lead-in shifts miss window", () => {
    const c = makeChart([1000]);
    const eng = new ScoringEngine(c, { chartLeadInMs: 4000 });
    const head = 5000;
    const beforeMiss = head + DEFAULT_HIT_WINDOWS.bad;
    expect(eng.evaluateMisses(beforeMiss)).toHaveLength(0);
    expect(eng.evaluateMisses(beforeMiss + 1)).toHaveLength(1);
  });

  it("chart lead-in shifts on-time hit", () => {
    const c = makeChart([1000]);
    const eng = new ScoringEngine(c, { chartLeadInMs: 4000 });
    const hit = eng.onNoteHit(0, 5000);
    expect(hit?.judgement).toBe("perfect");
  });

  it("fails an active hold when the lane is released early", () => {
    const holdChart: Chart = {
      trackId: "hold-test",
      difficulty: "medium",
      bpm: 120,
      generatorVersion: "test",
      generatedAt: new Date(),
      notes: [{ timeMs: 1000, lane: 0, durationMs: 800 }],
    };
    const eng = new ScoringEngine(holdChart);
    eng.onNoteHit(0, 1000);
    const mid = 1000 + 400;
    const fail = eng.advanceHolds(mid, [false, false, false, false]);
    expect(fail.some((e) => e.judgement === "miss")).toBe(true);
    expect(eng.isResolved(0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PlayModeController
// ---------------------------------------------------------------------------

describe("PlayModeController", () => {
  it("starts in autoplay by default", () => {
    const ctrl = new PlayModeController();
    expect(ctrl.getMode()).toBe("autoplay");
    expect(ctrl.isAutoplay()).toBe(true);
  });

  it("toggles to manual", () => {
    const ctrl = new PlayModeController();
    const mode = ctrl.toggle();
    expect(mode).toBe("manual");
    expect(ctrl.isAutoplay()).toBe(false);
  });

  it("fires onModeChange callback on toggle", () => {
    const ctrl = new PlayModeController();
    const calls: string[] = [];
    ctrl.setOnModeChange((m) => calls.push(m));
    ctrl.toggle();
    ctrl.toggle();
    expect(calls).toEqual(["manual", "autoplay"]);
  });

  it("setMode does not fire callback if mode unchanged", () => {
    const ctrl = new PlayModeController("autoplay");
    let fired = false;
    ctrl.setOnModeChange(() => { fired = true; });
    ctrl.setMode("autoplay");
    expect(fired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NoteWindowManager
// ---------------------------------------------------------------------------

describe("NoteWindowManager", () => {
  const chart = makeChart([500, 1000, 1500, 2000, 5000]);

  it("getVisibleNotes returns notes in look-ahead window", () => {
    const mgr = new NoteWindowManager(chart, 2000);
    const visible = mgr.getVisibleNotes(0);
    // All notes within 2000ms of position 0 (except 5000ms note)
    expect(visible.map((n) => n.note.timeMs)).toEqual([500, 1000, 1500, 2000]);
  });

  it("getAutoplayHits returns notes within perfect window", () => {
    const mgr = new NoteWindowManager(chart);
    const hits = mgr.getAutoplayHits(1000); // exactly at note index 1
    expect(hits.some((h) => h.note.timeMs === 1000)).toBe(true);
  });

  it("getMissedNotes excludes already judged notes", () => {
    const mgr = new NoteWindowManager(chart);
    const judged = new Set([0, 1]); // already judged
    const missed = mgr.getMissedNotes(3000, judged);
    const missedIndices = missed.map((m) => m.index);
    expect(missedIndices).not.toContain(0);
    expect(missedIndices).not.toContain(1);
  });
});
