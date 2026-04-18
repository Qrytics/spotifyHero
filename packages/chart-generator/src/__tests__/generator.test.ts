import { describe, it, expect } from "vitest";
import {
  generateDeterministicChart,
  estimateBpm,
  HybridChartGenerator,
  PassthroughMLRefiner,
  mergeAdjacentHoldNotes,
  DIFFICULTY_PARAMS,
} from "../index.js";
import type { BeatEvent, Note } from "@spotifyhero/shared-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBeatEvents(count: number, intervalMs: number): BeatEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    timeMs: i * intervalMs,
    confidence: 0.9,
    isBeat: true,
    isOnset: true,
  }));
}

// ---------------------------------------------------------------------------
// mergeAdjacentHoldNotes
// ---------------------------------------------------------------------------

describe("mergeAdjacentHoldNotes", () => {
  const gapMin = 220;
  const gapMax = 1600;
  const minHold = 280;

  it("merges three consecutive taps into one hold (no orphaned tap)", () => {
    const notes: Note[] = [
      { timeMs: 1000, lane: 0, durationMs: 0 },
      { timeMs: 1250, lane: 0, durationMs: 0 },
      { timeMs: 1500, lane: 0, durationMs: 0 },
    ];
    const out = mergeAdjacentHoldNotes(notes, gapMin, gapMax, minHold);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      timeMs: 1000,
      lane: 0,
      durationMs: 500,
    });
  });

  it("merges four consecutive taps into one hold", () => {
    const notes: Note[] = [
      { timeMs: 1000, lane: 2, durationMs: 0 },
      { timeMs: 1250, lane: 2, durationMs: 0 },
      { timeMs: 1500, lane: 2, durationMs: 0 },
      { timeMs: 1750, lane: 2, durationMs: 0 },
    ];
    const out = mergeAdjacentHoldNotes(notes, gapMin, gapMax, minHold);
    expect(out).toHaveLength(1);
    expect(out[0]!.durationMs).toBe(750);
  });

  it("breaks chain when a gap is below holdGapMinMs", () => {
    const notes: Note[] = [
      { timeMs: 1000, lane: 0, durationMs: 0 },
      { timeMs: 1210, lane: 0, durationMs: 0 },
      { timeMs: 1460, lane: 0, durationMs: 0 },
    ];
    const out = mergeAdjacentHoldNotes(notes, gapMin, gapMax, minHold);
    const taps = out.filter((n) => n.durationMs === 0);
    expect(taps.length).toBeGreaterThanOrEqual(2);
    expect(out.some((n) => n.durationMs > 0)).toBe(false);
  });

  it("demotes a pair to taps when total duration is below minHoldDurationMs", () => {
    const notes: Note[] = [
      { timeMs: 1000, lane: 0, durationMs: 0 },
      { timeMs: 1220, lane: 0, durationMs: 0 },
    ];
    const out = mergeAdjacentHoldNotes(notes, gapMin, gapMax, 280);
    expect(out).toHaveLength(2);
    expect(out.every((n) => n.durationMs === 0)).toBe(true);
  });

  it("uses minHoldDurationMs so expert may hold where easy demotes (300ms gap)", () => {
    const notes: Note[] = [
      { timeMs: 0, lane: 0, durationMs: 0 },
      { timeMs: 300, lane: 0, durationMs: 0 },
    ];
    const expertOut = mergeAdjacentHoldNotes(
      notes,
      200,
      1600,
      DIFFICULTY_PARAMS.expert.minHoldDurationMs
    );
    const easyOut = mergeAdjacentHoldNotes(
      notes,
      200,
      1600,
      DIFFICULTY_PARAMS.easy.minHoldDurationMs
    );
    expect(expertOut).toHaveLength(1);
    expect(expertOut[0]!.durationMs).toBe(300);
    expect(easyOut).toHaveLength(2);
    expect(easyOut.every((n) => n.durationMs === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateDeterministicChart
// ---------------------------------------------------------------------------

describe("generateDeterministicChart", () => {
  it("produces notes for all onsets at expert difficulty", () => {
    const beats = makeBeatEvents(20, 500); // 20 beats, 500ms apart
    const chart = generateDeterministicChart("t1", beats, 120, {
      difficulty: "expert",
    });
    expect(chart.notes.length).toBeGreaterThan(0);
    expect(chart.trackId).toBe("t1");
    expect(chart.difficulty).toBe("expert");
  });

  it("produces fewer notes at easy difficulty than expert", () => {
    const beats = makeBeatEvents(40, 250);
    const easy = generateDeterministicChart("t", beats, 240, {
      difficulty: "easy",
    });
    const expert = generateDeterministicChart("t", beats, 240, {
      difficulty: "expert",
    });
    expect(easy.notes.length).toBeLessThan(expert.notes.length);
  });

  it("assigns lanes within valid range (0-3)", () => {
    const beats = makeBeatEvents(20, 400);
    const chart = generateDeterministicChart("t", beats, 150, {
      difficulty: "medium",
    });
    for (const note of chart.notes) {
      expect(note.lane).toBeGreaterThanOrEqual(0);
      expect(note.lane).toBeLessThanOrEqual(3);
    }
  });

  it("respects minimum lane gap", () => {
    const beats = makeBeatEvents(10, 50); // very fast, 50ms apart
    const chart = generateDeterministicChart("t", beats, 1200, {
      difficulty: "expert",
      minGapMs: 80,
    });
    const laneTimes = new Map<number, number[]>();
    for (const note of chart.notes) {
      const arr = laneTimes.get(note.lane) ?? [];
      arr.push(note.timeMs);
      laneTimes.set(note.lane, arr);
    }
    for (const [, times] of laneTimes) {
      for (let i = 1; i < times.length; i++) {
        expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(79);
      }
    }
  });

  it("notes are sorted ascending by time", () => {
    const beats = makeBeatEvents(30, 300);
    const chart = generateDeterministicChart("t", beats, 200, {
      difficulty: "hard",
    });
    for (let i = 1; i < chart.notes.length; i++) {
      expect(chart.notes[i]!.timeMs).toBeGreaterThanOrEqual(
        chart.notes[i - 1]!.timeMs
      );
    }
  });

  it("uses deterministic-1.3 generator version", () => {
    const beats = makeBeatEvents(5, 500);
    const chart = generateDeterministicChart("v", beats, 120, {
      difficulty: "medium",
    });
    expect(chart.generatorVersion).toBe("deterministic-1.3");
  });

  it("confidence-first filter with mixed strengths yields fewer easy notes than expert", () => {
    const byTime = new Map<number, BeatEvent>();
    for (let i = 0; i < 64; i++) {
      const t = i * 125;
      byTime.set(t, {
        timeMs: t,
        confidence: 0.42,
        isBeat: true,
        isOnset: true,
      });
    }
    for (let i = 0; i < 16; i++) {
      const t = i * 1000;
      byTime.set(t, {
        timeMs: t,
        confidence: 0.9,
        isBeat: true,
        isOnset: true,
      });
    }
    const mixed = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
    const easy = generateDeterministicChart("mix", mixed, 120, {
      difficulty: "easy",
    });
    const expert = generateDeterministicChart("mix", mixed, 120, {
      difficulty: "expert",
    });
    expect(expert.notes.length).toBeGreaterThan(easy.notes.length);
  });
});

// ---------------------------------------------------------------------------
// estimateBpm
// ---------------------------------------------------------------------------

describe("estimateBpm", () => {
  it("estimates 120 BPM from 500ms beat intervals", () => {
    const beats = makeBeatEvents(20, 500);
    expect(estimateBpm(beats)).toBe(120);
  });

  it("returns 120 default when too few beats", () => {
    expect(estimateBpm([])).toBe(120);
    expect(
      estimateBpm([
        { timeMs: 0, confidence: 0.9, isBeat: true, isOnset: false },
      ])
    ).toBe(120);
  });

  it("ignores low-confidence beats", () => {
    const beats: BeatEvent[] = [
      { timeMs: 0, confidence: 0.9, isBeat: true, isOnset: true },
      { timeMs: 500, confidence: 0.9, isBeat: true, isOnset: true },
      { timeMs: 600, confidence: 0.1, isBeat: true, isOnset: true },
      { timeMs: 1000, confidence: 0.9, isBeat: true, isOnset: true },
    ];
    expect(estimateBpm(beats)).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// HybridChartGenerator
// ---------------------------------------------------------------------------

describe("HybridChartGenerator", () => {
  it("falls back to deterministic chart when ML returns low confidence", async () => {
    const gen = new HybridChartGenerator(new PassthroughMLRefiner(), 0.65);
    const beats = makeBeatEvents(20, 500);
    const chart = await gen.generate("t", beats, 120, { difficulty: "medium" });
    expect(chart.generatorVersion).toBe("deterministic-1.3");
  });

  it("returns a valid chart shape", async () => {
    const gen = new HybridChartGenerator();
    const beats = makeBeatEvents(10, 600);
    const chart = await gen.generate("track-x", beats, 100, {
      difficulty: "hard",
    });
    expect(chart.trackId).toBe("track-x");
    expect(Array.isArray(chart.notes)).toBe(true);
    expect(chart.bpm).toBe(100);
  });
});
