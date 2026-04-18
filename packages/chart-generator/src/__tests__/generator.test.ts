import { describe, it, expect } from "vitest";
import {
  generateDeterministicChart,
  estimateBpm,
  HybridChartGenerator,
  PassthroughMLRefiner,
} from "../index.js";
import type { BeatEvent } from "@spotifyhero/shared-types";

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
    const easy = generateDeterministicChart("t", beats, 240, { difficulty: "easy" });
    const expert = generateDeterministicChart("t", beats, 240, { difficulty: "expert" });
    expect(easy.notes.length).toBeLessThan(expert.notes.length);
  });

  it("assigns lanes within valid range (0-3)", () => {
    const beats = makeBeatEvents(20, 400);
    const chart = generateDeterministicChart("t", beats, 150, { difficulty: "medium" });
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
    // Group by lane and check gaps
    const laneTimes = new Map<number, number[]>();
    for (const note of chart.notes) {
      const arr = laneTimes.get(note.lane) ?? [];
      arr.push(note.timeMs);
      laneTimes.set(note.lane, arr);
    }
    for (const [, times] of laneTimes) {
      for (let i = 1; i < times.length; i++) {
        expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(79); // allow 1ms rounding
      }
    }
  });

  it("notes are sorted ascending by time", () => {
    const beats = makeBeatEvents(30, 300);
    const chart = generateDeterministicChart("t", beats, 200, { difficulty: "hard" });
    for (let i = 1; i < chart.notes.length; i++) {
      expect(chart.notes[i]!.timeMs).toBeGreaterThanOrEqual(
        chart.notes[i - 1]!.timeMs
      );
    }
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
    expect(estimateBpm([{ timeMs: 0, confidence: 0.9, isBeat: true, isOnset: false }])).toBe(120);
  });

  it("ignores low-confidence beats", () => {
    const beats: BeatEvent[] = [
      { timeMs: 0, confidence: 0.9, isBeat: true, isOnset: true },
      { timeMs: 500, confidence: 0.9, isBeat: true, isOnset: true },
      { timeMs: 600, confidence: 0.1, isBeat: true, isOnset: true }, // low confidence, excluded
      { timeMs: 1000, confidence: 0.9, isBeat: true, isOnset: true },
    ];
    // Should use 500ms intervals → 120 BPM
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
    // PassthroughMLRefiner always returns confidence 0, so deterministic is used
    expect(chart.generatorVersion).toBe("deterministic-1.1");
  });

  it("returns a valid chart shape", async () => {
    const gen = new HybridChartGenerator();
    const beats = makeBeatEvents(10, 600);
    const chart = await gen.generate("track-x", beats, 100, { difficulty: "hard" });
    expect(chart.trackId).toBe("track-x");
    expect(Array.isArray(chart.notes)).toBe(true);
    expect(chart.bpm).toBe(100);
  });
});
