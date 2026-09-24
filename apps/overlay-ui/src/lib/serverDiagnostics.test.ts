import { describe, expect, it } from "vitest";
import type { BeatEvent, Chart, Note } from "@spotifyhero/shared-types";
import { DIFFICULTY_PARAMS } from "@spotifyhero/chart-generator";
import { summarizeChart, summarizeConfidence } from "./serverDiagnostics.js";

function onset(confidence: number): BeatEvent {
  return { timeMs: 0, confidence, isBeat: false, isOnset: true };
}

function gridBeat(confidence: number): BeatEvent {
  return { timeMs: 0, confidence, isBeat: true, isOnset: false };
}

function chartOf(notes: Note[]): Chart {
  return {
    trackId: "nd:1",
    difficulty: "easy",
    notes,
    bpm: 120,
    generatorVersion: "test-1",
    generatedAt: new Date(0),
  };
}

describe("summarizeConfidence", () => {
  it("summarizes onsets only — synthetic grid filler would flatten the shape", () => {
    const summary = summarizeConfidence(
      [onset(0.2), gridBeat(0.99), onset(0.8), gridBeat(0.01)],
      "easy"
    );
    expect(summary.onsetCount).toBe(2);
    expect(summary.min).toBeCloseTo(0.2);
    expect(summary.max).toBeCloseTo(0.8);
    expect(summary.mean).toBeCloseTo(0.5);
  });

  it("reports nearest-rank percentiles", () => {
    const summary = summarizeConfidence(
      [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(onset),
      "easy"
    );
    expect(summary.p25).toBeCloseTo(0.3);
    expect(summary.median).toBeCloseTo(0.5);
    expect(summary.p75).toBeCloseTo(0.8);
    expect(summary.p90).toBeCloseTo(0.9);
  });

  it("buckets into ten 0.1-wide bins, with 1.0 in the last bin", () => {
    const summary = summarizeConfidence([onset(0), onset(0.05), onset(0.95), onset(1)], "easy");
    expect(summary.histogram).toHaveLength(10);
    expect(summary.histogram[0]).toBe(2);
    expect(summary.histogram[9]).toBe(2);
    expect(summary.histogram.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("counts onsets against the difficulty's own thresholds", () => {
    const easy = DIFFICULTY_PARAMS.easy;
    const summary = summarizeConfidence(
      [
        onset(easy.onsetConfidenceFloor), // dropped: the gate is strictly greater
        onset(easy.onsetConfidenceFloor + 0.01),
        onset(easy.sustainConfidenceMin),
        onset(0.99),
      ],
      "easy"
    );
    expect(summary.aboveOnsetFloor).toBe(3);
    expect(summary.aboveSustainMin).toBe(2);
  });

  it("does not divide by zero on an empty analysis", () => {
    const summary = summarizeConfidence([], "expert");
    expect(summary).toMatchObject({ onsetCount: 0, mean: 0, median: 0, max: 0 });
  });
});

describe("summarizeChart", () => {
  const notes: Note[] = [
    { timeMs: 0, lane: 0, durationMs: 0 },
    { timeMs: 500, lane: 0, durationMs: 800 },
    { timeMs: 1700, lane: 3, durationMs: 0 },
    { timeMs: 2000, lane: 3, durationMs: 400 },
  ];

  it("counts sustains, lanes and gaps", () => {
    const s = summarizeChart(chartOf(notes), 60_000);
    expect(s.noteCount).toBe(4);
    expect(s.sustainCount).toBe(2);
    expect(s.sustainPercent).toBeCloseTo(0.5);
    expect(s.longestSustainMs).toBe(800);
    expect(s.laneCounts).toEqual([2, 0, 0, 2]);
    expect(s.minGapMs).toBe(300);
    expect(s.medianGapMs).toBe(500);
    expect(s.notesPerMinute).toBeCloseTo(4);
  });

  it("falls back to the note span when the duration is unknown", () => {
    const s = summarizeChart(chartOf(notes), null);
    expect(s.notesPerMinute).toBeCloseTo(4 / (2000 / 60_000));
  });

  it("survives an empty chart — the case the panel exists to explain", () => {
    const s = summarizeChart(chartOf([]), 120_000);
    expect(s).toMatchObject({
      noteCount: 0,
      sustainCount: 0,
      sustainPercent: 0,
      notesPerMinute: 0,
      minGapMs: null,
      medianGapMs: null,
    });
  });
});
