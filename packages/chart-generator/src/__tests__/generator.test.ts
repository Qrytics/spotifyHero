import { describe, it, expect } from "vitest";
import type { BeatEvent, Note } from "@spotifyhero/shared-types";
import {
  generateDeterministicChart,
  estimateBpm,
  HybridChartGenerator,
  PassthroughMLRefiner,
  mergeAdjacentHoldNotes,
  mergeContiguousSustainSeries,
  DIFFICULTY_PARAMS,
} from "../index.js";
import { buildRhythmContext, inferBeatsPerMeasure } from "../rhythm.js";

describe("rhythm context", () => {
  it("counts onsets per quarter-beat window for mixed subdivisions", () => {
    const beatMs = 500;
    const events: BeatEvent[] = [];
    for (let t = 0; t < 8 * beatMs; t += beatMs) {
      events.push({
        timeMs: t,
        confidence: 0.9,
        isBeat: true,
        isOnset: true,
      });
    }
    const onsets: BeatEvent[] = [];
    for (let t = 0; t < 8 * beatMs; t += beatMs / 4) {
      onsets.push({
        timeMs: t,
        confidence: 0.85,
        isBeat: false,
        isOnset: true,
      });
    }
    const ctx = buildRhythmContext(events, onsets, 120);
    expect(ctx.onsetsPerBeat.some((c) => c >= 3)).toBe(true);
    expect(ctx.beatsPerMeasure === 3 || ctx.beatsPerMeasure === 4).toBe(true);
  });

  it("inferBeatsPerMeasure prefers 3 for waltz-like accent spacing", () => {
    const pat: number[] = [];
    for (let i = 0; i < 40; i++) {
      pat.push(i % 3 === 0 ? 5 : 1);
    }
    expect(inferBeatsPerMeasure(pat)).toBe(3);
  });

  it("raises melodicAggression when pitch jumps between fast onsets", () => {
    const beatMs = 500;
    const events: BeatEvent[] = [
      { timeMs: 0, confidence: 0.9, isBeat: true, isOnset: true },
    ];
    const onsets: BeatEvent[] = [];
    const base = 440;
    for (let i = 0; i < 8; i++) {
      const t = 50 + i * 45;
      onsets.push({
        timeMs: t,
        confidence: 0.88,
        isBeat: false,
        isOnset: true,
        pitchHz: base * 2 ** (i / 3),
        spectralFlux: 0.4 + i * 0.05,
        rms: 0.2 + i * 0.03,
      });
    }
    const ctx = buildRhythmContext(events, onsets, 120);
    expect(ctx.melodicAggression.length).toBe(ctx.onsetsPerBeat.length);
    const maxMel = Math.max(...ctx.melodicAggression);
    expect(maxMel).toBeGreaterThan(0.25);
  });
});

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

function countTapHold(notes: readonly Note[]): { taps: number; holds: number } {
  let taps = 0;
  let holds = 0;
  for (const note of notes) {
    if (note.durationMs > 0) holds += 1;
    else taps += 1;
  }
  return { taps, holds };
}

function hasEligibleSustainWindow(
  beats: readonly BeatEvent[],
  difficulty: keyof typeof DIFFICULTY_PARAMS,
  bpm: number
): boolean {
  const preset = DIFFICULTY_PARAMS[difficulty];
  const sustainGapMaxMs = Math.max(
    preset.holdGapMinMs,
    preset.minHoldDurationMs,
    Math.min(
      preset.holdGapMaxMs,
      Math.round((60_000 / Math.max(1, bpm)) * preset.holdGapBeatFraction)
    )
  );
  for (let i = 0; i + 1 < beats.length; i++) {
    const curr = beats[i]!;
    const next = beats[i + 1]!;
    const gap = next.timeMs - curr.timeMs;
    if (
      gap >= preset.holdGapMinMs &&
      gap <= sustainGapMaxMs &&
      gap >= preset.minHoldDurationMs &&
      Math.min(curr.confidence, next.confidence) >= preset.sustainConfidenceMin
    ) {
      return true;
    }
  }
  return false;
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

  it("uses minHoldDurationMs so expert may hold where easy demotes (460ms gap)", () => {
    const notes: Note[] = [
      { timeMs: 0, lane: 0, durationMs: 0 },
      { timeMs: 460, lane: 0, durationMs: 0 },
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
    expect(expertOut[0]!.durationMs).toBe(460);
    expect(easyOut).toHaveLength(2);
    expect(easyOut.every((n) => n.durationMs === 0)).toBe(true);
  });

  it("with holdDemergePercent 100, eligible chain stays taps", () => {
    const notes: Note[] = [
      { timeMs: 1000, lane: 0, durationMs: 0 },
      { timeMs: 1250, lane: 0, durationMs: 0 },
      { timeMs: 1500, lane: 0, durationMs: 0 },
    ];
    const out = mergeAdjacentHoldNotes(notes, gapMin, gapMax, minHold, 1400, 100);
    expect(out).toHaveLength(3);
    expect(out.every((n) => n.durationMs === 0)).toBe(true);
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

  it("uses deterministic-1.9 generator version", () => {
    const beats = makeBeatEvents(5, 500);
    const chart = generateDeterministicChart("v", beats, 120, {
      difficulty: "medium",
    });
    expect(chart.generatorVersion).toBe("deterministic-1.9");
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

  it("expert yields more tap density than hard on fast streams", () => {
    const beats = makeBeatEvents(160, 125);
    const hard = generateDeterministicChart("dense", beats, 120, {
      difficulty: "hard",
    });
    const expert = generateDeterministicChart("dense", beats, 120, {
      difficulty: "expert",
    });
    expect(expert.notes.length).toBeGreaterThan(hard.notes.length);
  });

  it("expert can generate simultaneous chord notes", () => {
    const beats = makeBeatEvents(320, 90);
    const chart = generateDeterministicChart("chords", beats, 166, {
      difficulty: "expert",
    });
    const byTime = new Map<number, number>();
    for (const note of chart.notes) {
      byTime.set(note.timeMs, (byTime.get(note.timeMs) ?? 0) + 1);
    }
    const maxChord = Math.max(...byTime.values());
    expect(maxChord).toBeGreaterThanOrEqual(2);
  });

  it("expert retains sustain notes on moderate tempo patterns", () => {
    const beats = makeBeatEvents(180, 240);
    const chart = generateDeterministicChart("sustain-expert", beats, 125, {
      difficulty: "expert",
    });
    const counts = countTapHold(chart.notes);
    expect(counts.holds).toBeGreaterThan(0);
  });

  it("keeps sustain frequency within explicit per-difficulty bounds", () => {
    const beats = makeBeatEvents(220, 120);
    const diffs = ["easy", "medium", "hard", "expert"] as const;
    for (const difficulty of diffs) {
      const chart = generateDeterministicChart("ratio-check", beats, 125, {
        difficulty,
      });
      const counts = countTapHold(chart.notes);
      const total = counts.taps + counts.holds;
      if (total === 0) continue;
      const sustainPct = counts.holds / total;
      const preset = DIFFICULTY_PARAMS[difficulty];
      if (hasEligibleSustainWindow(beats, difficulty, estimateBpm(beats))) {
        expect(sustainPct).toBeGreaterThanOrEqual(
          preset.minSustainPercent - 0.01
        );
      }
      expect(sustainPct).toBeLessThanOrEqual(
        preset.maxSustainPercent + 0.01
      );
    }
  });

  it("merges same-lane sustain chains into one hold after assignment cap", () => {
    const merged = mergeContiguousSustainSeries([
      { timeMs: 0, lane: 0, durationMs: 400 },
      { timeMs: 400, lane: 0, durationMs: 300 },
      { timeMs: 700, lane: 0, durationMs: 0 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      timeMs: 0,
      lane: 0,
      durationMs: 700,
    });
    expect(merged[1]).toMatchObject({ timeMs: 700, lane: 0, durationMs: 0 });
  });

  it("suppresses note generation during confirmed silence windows", () => {
    const beats: BeatEvent[] = [
      { timeMs: 0, confidence: 0.9, isBeat: true, isOnset: true, amplitude: 0.8, rms: 0.7 },
      { timeMs: 100, confidence: 0.9, isBeat: true, isOnset: true, amplitude: 0.02, rms: 0.02 },
      { timeMs: 200, confidence: 0.9, isBeat: true, isOnset: true, amplitude: 0.02, rms: 0.02 },
      { timeMs: 300, confidence: 0.9, isBeat: true, isOnset: true, amplitude: 0.02, rms: 0.02 },
      { timeMs: 400, confidence: 0.9, isBeat: true, isOnset: true, amplitude: 0.02, rms: 0.02 },
      { timeMs: 500, confidence: 0.9, isBeat: true, isOnset: true, amplitude: 0.09, rms: 0.08 },
      { timeMs: 600, confidence: 0.9, isBeat: true, isOnset: true, amplitude: 0.09, rms: 0.08 },
    ];
    const chart = generateDeterministicChart("silence", beats, 120, {
      difficulty: "expert",
      minGapMs: 1,
    });
    expect(chart.notes.some((n) => n.timeMs >= 300 && n.timeMs <= 400)).toBe(
      false
    );
    expect(chart.notes.some((n) => n.timeMs === 600)).toBe(true);
  });

  it("uses hysteresis so brief noise-floor bumps do not confirm silence", () => {
    const beats: BeatEvent[] = [
      { timeMs: 0, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.02, rms: 0.02 },
      { timeMs: 80, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.02, rms: 0.02 },
      { timeMs: 160, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.02, rms: 0.02 },
      { timeMs: 240, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.049, rms: 0.035 },
      { timeMs: 320, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.047, rms: 0.034 },
      { timeMs: 400, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.06, rms: 0.04 },
      { timeMs: 480, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.08, rms: 0.06 },
      { timeMs: 560, confidence: 0.95, isBeat: true, isOnset: true, amplitude: 0.09, rms: 0.07 },
    ];
    const chart = generateDeterministicChart("hys", beats, 120, {
      difficulty: "expert",
      minGapMs: 1,
    });
    expect(chart.notes.some((n) => n.timeMs === 240 || n.timeMs === 320 || n.timeMs === 400)).toBe(true);
    expect(chart.notes.some((n) => n.timeMs === 560)).toBe(true);
  });

  it("supports normalization profile tuning for silence thresholding", () => {
    const beats: BeatEvent[] = [
      { timeMs: 0, confidence: 0.96, isBeat: true, isOnset: true, amplitude: 0.8, rms: 0.6 },
      { timeMs: 100, confidence: 0.96, isBeat: true, isOnset: true, amplitude: 0.034, rms: 0.023 },
      { timeMs: 200, confidence: 0.96, isBeat: true, isOnset: true, amplitude: 0.034, rms: 0.023 },
      { timeMs: 300, confidence: 0.96, isBeat: true, isOnset: true, amplitude: 0.034, rms: 0.023 },
      { timeMs: 400, confidence: 0.96, isBeat: true, isOnset: true, amplitude: 0.07, rms: 0.05 },
    ];
    const quiet = generateDeterministicChart("profile", beats, 120, {
      difficulty: "expert",
      normalizationProfile: "quiet",
    });
    const loud = generateDeterministicChart("profile", beats, 120, {
      difficulty: "expert",
      normalizationProfile: "loud",
    });
    expect(loud.notes.length).toBeLessThanOrEqual(quiet.notes.length);
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
    expect(chart.generatorVersion).toBe("deterministic-1.9");
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
