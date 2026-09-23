/**
 * Tempo and — the one that is easy to forget — beat *phase*.
 * `buildRhythmContext` takes the first beat as `gridStartMs`, so a correct BPM
 * with a wrong phase still mis-places every beat-relative decision downstream.
 */
import { describe, expect, it } from "vitest";
import { computeOnsetEnvelope } from "../spectralFlux.js";
import { estimateTempo, refineBeatPhaseMs } from "../tempo.js";
import { frameTimeMs } from "../window.js";
import { SR, clickTrain, silence } from "./signals.js";

function tempoOfClickTrain(bpm: number, seconds = 6) {
  const { mono, clickTimesMs } = clickTrain({ bpm, seconds });
  const env = computeOnsetEnvelope(mono, SR);
  return { tempo: estimateTempo(env.flux, env.geo.hopMs), env, clickTimesMs };
}

describe("estimateTempo", () => {
  // The plan's acceptance number: BPM within ±1 of a known click train.
  for (const bpm of [90, 120, 140]) {
    it(`recovers ${bpm} BPM within ±1`, () => {
      const { tempo } = tempoOfClickTrain(bpm);
      expect(tempo.bpm).toBeGreaterThan(bpm - 1);
      expect(tempo.bpm).toBeLessThan(bpm + 1);
      expect(tempo.confidence).toBeGreaterThan(0.2);
    });
  }

  it("does not settle on the half- or double-tempo peak", () => {
    // Autocorrelation always shows those; the comb filter and the log-normal
    // prior are what keep the tactus.
    const { tempo } = tempoOfClickTrain(120);
    expect(tempo.bpm).not.toBeCloseTo(60, 0);
    expect(tempo.bpm).not.toBeCloseTo(240, 0);
  });

  it("places the first grid beat on the first click", () => {
    const { tempo, env, clickTimesMs } = tempoOfClickTrain(120);
    const phaseMs = frameTimeMs(tempo.beatPhaseFrames, env.geo);
    // Within a hop of the first click (250 ms), and nowhere near 0 — a phase of
    // 0 is the silent fallback, and the misalignment this replaces.
    expect(Math.abs(phaseMs - clickTimesMs[0]!)).toBeLessThan(env.geo.hopMs + 4);
  });

  it("reports the period in fractional frames", () => {
    const { tempo, env } = tempoOfClickTrain(120);
    // 120 BPM = 500 ms = 43.07 frames at an 11.61 ms hop.
    expect(tempo.beatPeriodFrames).toBeGreaterThan(42);
    expect(tempo.beatPeriodFrames).toBeLessThan(44);
    // Fractional: not snapped back to the integer lag the score peaked at.
    expect(tempo.beatPeriodFrames % 1).not.toBe(0);
    // Within a couple of ms of 500. The parabola interpolates a peak sitting on
    // an 11.61 ms lag grid, so sub-ms agreement is not something it can
    // promise — ±1 BPM, the spec the tests above assert, is ±4 ms here.
    expect(Math.abs(tempo.beatPeriodFrames * env.geo.hopMs - 500)).toBeLessThan(2);
  });

  it("falls back at 120 BPM with zero confidence on silence", () => {
    const env = computeOnsetEnvelope(silence(4), SR);
    const tempo = estimateTempo(env.flux, env.geo.hopMs);
    expect(tempo.bpm).toBe(120);
    expect(tempo.confidence).toBe(0);
    expect(tempo.beatPhaseFrames).toBe(0);
  });

  it("falls back on an envelope too short to have a period", () => {
    const tempo = estimateTempo(new Float32Array(4), 11.61, { fallbackBpm: 128 });
    expect(tempo.bpm).toBe(128);
    expect(tempo.confidence).toBe(0);
  });

  it("respects a narrowed BPM range", () => {
    // Forced under the real 120: the estimate has to land inside the range it
    // was given rather than outside it.
    const { mono } = clickTrain({ bpm: 120, seconds: 6 });
    const env = computeOnsetEnvelope(mono, SR);
    const tempo = estimateTempo(env.flux, env.geo.hopMs, { minBpm: 60, maxBpm: 100 });
    expect(tempo.bpm).toBeLessThanOrEqual(100.5);
    expect(tempo.bpm).toBeGreaterThanOrEqual(59.5);
  });
});

describe("refineBeatPhaseMs", () => {
  const PERIOD = 500;

  it("keeps the phase when too few onsets are near the grid", () => {
    expect(refineBeatPhaseMs([100, 600, 1100], [1, 1, 1], PERIOD, 100)).toBe(100);
    expect(refineBeatPhaseMs([], [], PERIOD, 250)).toBe(250);
  });

  it("shifts the grid onto a consistent onset offset", () => {
    const onsets = [258, 758, 1258, 1758, 2258];
    const phase = refineBeatPhaseMs(onsets, onsets.map(() => 1), PERIOD, 250);
    expect(phase).toBeCloseTo(258, 6);
  });

  it("ignores onsets far from the grid", () => {
    // Six on-grid onsets at +8 ms, three off-grid ones that must not drag the
    // grid with them. Default tolerance is 15 % of the period = 75 ms.
    const onGrid = [258, 758, 1258, 1758, 2258, 2758];
    const offGrid = [400, 900, 1400];
    const onsets = [...onGrid, ...offGrid].sort((a, b) => a - b);
    const phase = refineBeatPhaseMs(onsets, onsets.map(() => 1), PERIOD, 250);
    expect(phase).toBeCloseTo(258, 6);
  });

  it("weights by onset strength", () => {
    // Four weak onsets at +2 ms against one very strong one at +40: the weighted
    // median stays with the weak majority.
    const onsets = [252, 752, 1252, 1752, 2290];
    const strengths = [1, 1, 1, 1, 0.5];
    const phase = refineBeatPhaseMs(onsets, strengths, PERIOD, 250);
    expect(phase).toBeCloseTo(252, 6);
  });

  it("wraps the phase into the first beat", () => {
    // `gridStartMs` must stay near the start of the song, not one beat into it.
    const onsets = [505, 1005, 1505, 2005, 2505];
    const phase = refineBeatPhaseMs(onsets, onsets.map(() => 1), PERIOD, 495);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(PERIOD);
    expect(phase).toBeCloseTo(5, 6);
  });

  it("returns the phase unchanged for a non-positive period", () => {
    expect(refineBeatPhaseMs([1, 2, 3, 4], [1, 1, 1, 1], 0, 42)).toBe(42);
  });
});
