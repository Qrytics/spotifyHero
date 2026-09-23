/**
 * The entry point, tested for the three properties the chart pipeline actually
 * depends on — the three things the module header calls out:
 *
 *  1. onset times are real and unbiased (no 2000 ms `demoBeatEvents` fudge),
 *  2. `amplitude` / `rms` are absolute, so `applySilenceGate` still works,
 *  3. a **complete** `isBeat` grid is emitted, because `buildRhythmContext`
 *     needs ≥ 4 beats and takes the first one as `gridStartMs`.
 */
import { describe, expect, it } from "vitest";
import type { BeatEvent } from "@spotifyhero/shared-types";
import { analyzeOnsets } from "../analyzeOnsets.js";
import { SR, clickTrain, mean, silence, sine } from "./signals.js";

/** Signed error, per click, to the nearest detected onset. */
function onsetErrorsMs(events: readonly BeatEvent[], clickTimesMs: readonly number[]) {
  const onsets = events.filter((e) => e.isOnset).map((e) => e.timeMs);
  return clickTimesMs.map((clickMs) => {
    let best = Infinity;
    for (const t of onsets) {
      const d = t - clickMs;
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    return best;
  });
}

describe("analyzeOnsets", () => {
  describe("on a 120 BPM click train", () => {
    const { mono, clickTimesMs } = clickTrain({ bpm: 120, seconds: 8 });
    const result = analyzeOnsets(mono, SR);

    it("finds every click", () => {
      expect(clickTimesMs.length).toBeGreaterThan(10);
      expect(result.stats.onsetCount).toBeGreaterThanOrEqual(clickTimesMs.length);
      // A click on silence is unmissable; anything much beyond one onset per
      // click means the peak picker is double-triggering on the decay.
      expect(result.stats.onsetCount).toBeLessThanOrEqual(clickTimesMs.length + 2);
    });

    it("places them within ±15 ms, and early rather than late", () => {
      const errors = onsetErrorsMs(result.events, clickTimesMs);
      for (const e of errors) expect(Math.abs(e)).toBeLessThanOrEqual(15);
      // With a silent baseline, log-compressed flux peaks at the first frame
      // whose window catches the transient — a systematic lead of up to one hop
      // (11.6 ms), which the per-source timing offset absorbs. What must not
      // happen is a *lag*, or a drift that grows through the track.
      expect(mean(errors.map(Math.abs))).toBeLessThanOrEqual(12);
      // No drift: the spread of the errors stays inside the hop-quantization
      // band instead of walking away over 8 seconds.
      expect(Math.max(...errors) - Math.min(...errors)).toBeLessThanOrEqual(14);
    });

    it("recovers the tempo within ±1 BPM", () => {
      expect(result.bpm).toBeGreaterThan(119);
      expect(result.bpm).toBeLessThan(121);
    });

    it("does not bias the phase forward like the synthetic grid did", () => {
      // `demoBeatEvents` shifted everything by 2000 ms. The first click here is
      // at 250 ms and that is where the grid has to start.
      expect(result.beatPhaseMs).toBeGreaterThan(200);
      expect(result.beatPhaseMs).toBeLessThan(300);
      const firstOnset = result.events.find((e) => e.isOnset);
      expect(firstOnset!.timeMs).toBeLessThan(400);
    });

    it("emits a grid buildRhythmContext can use", () => {
      const beats = result.events.filter((e) => e.isBeat);
      expect(beats.length).toBeGreaterThanOrEqual(4);
      // `gridStartMs` is beats[0] — it must be the downbeat, not 0.
      expect(beats[0]!.timeMs).toBeGreaterThan(200);
      expect(beats[0]!.timeMs).toBeLessThan(300);
      // Spacing is the beat period throughout — one pulse, no gaps and no
      // doubled grid. The band is wide because a beat claimed by a real onset
      // carries the onset's time, not the grid line's.
      for (let i = 1; i < beats.length; i++) {
        const spacing = beats[i]!.timeMs - beats[i - 1]!.timeMs;
        expect(spacing).toBeGreaterThan(470);
        expect(spacing).toBeLessThan(530);
      }
    });

    it("scores grid-aligned onsets high enough for Easy and for sustains", () => {
      // Above every difficulty's `sustainConfidenceMin` (max 0.72) and above
      // Easy's confidence-first density filter, or real music charts empty.
      const aligned = result.events.filter((e) => e.isOnset && e.isBeat);
      expect(aligned.length).toBeGreaterThanOrEqual(clickTimesMs.length - 1);
      for (const e of aligned) expect(e.confidence).toBeGreaterThanOrEqual(0.9);
      for (const e of result.events) {
        expect(e.confidence).toBeGreaterThan(0);
        expect(e.confidence).toBeLessThanOrEqual(0.99);
      }
    });

    it("returns events sorted, on whole milliseconds, inside the track", () => {
      for (let i = 1; i < result.events.length; i++) {
        expect(result.events[i]!.timeMs).toBeGreaterThan(result.events[i - 1]!.timeMs);
      }
      for (const e of result.events) {
        expect(Number.isInteger(e.timeMs)).toBe(true);
        expect(e.timeMs).toBeGreaterThanOrEqual(0);
        expect(e.timeMs).toBeLessThan(result.durationMs);
      }
      expect(result.durationMs).toBeCloseTo(8000, 0);
    });

    it("attaches a plausible pitch hint to the onsets", () => {
      // The clicks are 1200 Hz. `pitchHz` only has to be good enough for
      // step-to-step melodic motion, but a wildly wrong value would mean the
      // harmonic scoring picked a subharmonic.
      const pitched = result.events.filter((e) => e.pitchHz !== undefined);
      expect(pitched.length).toBeGreaterThan(0);
      for (const e of pitched) {
        expect(e.pitchHz!).toBeGreaterThan(1100);
        expect(e.pitchHz!).toBeLessThan(1300);
      }
      expect(result.stats.pitchedOnsetCount).toBe(pitched.length);
    });

    it("omits pitch entirely when asked to", () => {
      const noPitch = analyzeOnsets(mono, SR, { estimatePitch: false });
      for (const e of noPitch.events) expect(e.pitchHz).toBeUndefined();
      expect(noPitch.stats.pitchedOnsetCount).toBe(0);
      // `exactOptionalPropertyTypes`: the key is absent, not set to undefined.
      for (const e of noPitch.events) expect("pitchHz" in e).toBe(false);
    });

    it("reports stats the diagnostics panel can tune against", () => {
      const s = result.stats;
      expect(s.hopMs).toBeCloseTo(11.61, 2);
      expect(s.frameCount).toBeGreaterThan(600);
      expect(s.gridAlignedOnsetCount).toBeGreaterThan(0);
      expect(s.beatEventCount).toBeGreaterThanOrEqual(4);
      expect(s.tempoConfidence).toBeGreaterThan(0);
      expect(s.fluxP95).toBeGreaterThanOrEqual(s.fluxMedian);
      expect(s.amplitudeP90).toBeGreaterThanOrEqual(0);
    });
  });

  it("fills a silent passage with beat-only events", () => {
    // Nothing is detected through a breakdown, but the pulse still has to be
    // there or `gridStartMs` falls back to 0 and the whole chart shifts.
    const { mono } = clickTrain({ bpm: 120, seconds: 8 });
    const gapped = Float32Array.from(mono);
    gapped.fill(0, Math.round(3 * SR), Math.round(5 * SR));

    const result = analyzeOnsets(gapped, SR, { estimatePitch: false });
    const filler = result.events.filter(
      (e) => e.isBeat && !e.isOnset && e.timeMs > 3000 && e.timeMs < 5000
    );
    expect(filler.length).toBeGreaterThanOrEqual(3);
    for (const e of filler) {
      // Below a grid-aligned onset, above nothing: these must never become notes.
      expect(e.confidence).toBeLessThan(0.9);
      expect(e.isOnset).toBe(false);
      // Absolute level, measured in the gap: near silence.
      expect(e.amplitude).toBeLessThan(0.02);
    }
    // And no onsets invented inside the gap.
    const inGap = result.events.filter(
      (e) => e.isOnset && e.timeMs > 3100 && e.timeMs < 4900
    );
    expect(inGap).toHaveLength(0);
  });

  it("charts nothing from silence, but still emits a grid", () => {
    const result = analyzeOnsets(silence(4), SR);
    expect(result.stats.onsetCount).toBe(0);
    expect(result.events.every((e) => !e.isOnset)).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(4);
    expect(result.bpm).toBe(120); // tempo fallback
    expect(result.stats.tempoConfidence).toBe(0);
    for (const e of result.events) {
      expect(e.amplitude).toBe(0);
      expect(e.rms).toBe(0);
    }
  });

  it("keeps event levels absolute so the silence gate still works", () => {
    const loud = clickTrain({ bpm: 120, seconds: 4, amplitude: 0.8 });
    const quiet = Float32Array.from(loud.mono, (v) => v * 0.25);

    const a = analyzeOnsets(loud.mono, SR, { estimatePitch: false });
    const b = analyzeOnsets(quiet, SR, { estimatePitch: false });

    const peakAmplitude = (events: readonly BeatEvent[]): number =>
      events.reduce((m, e) => Math.max(m, e.amplitude ?? 0), 0);

    // Roughly a quarter — if these came out equal, the analysis is normalizing
    // and every quiet intro would get charted.
    expect(peakAmplitude(b.events)).toBeLessThan(peakAmplitude(a.events) * 0.4);
    expect(peakAmplitude(b.events)).toBeGreaterThan(peakAmplitude(a.events) * 0.1);
  });

  describe("normalizationProfile", () => {
    // Steady tones, so frame RMS is the tone's RMS everywhere and the profile
    // boundaries are exact rather than statistical.
    it("calls a quiet master quiet", () => {
      // 0.1 amplitude → RMS 0.071, under the 0.08 boundary.
      expect(analyzeOnsets(sine(440, 2, 0.1), SR, { estimatePitch: false })
        .normalizationProfile).toBe("quiet");
    });

    it("calls a normal master balanced", () => {
      // 0.2 amplitude → RMS 0.141.
      expect(analyzeOnsets(sine(440, 2, 0.2), SR, { estimatePitch: false })
        .normalizationProfile).toBe("balanced");
    });

    it("calls a loud master loud", () => {
      // 0.5 amplitude → RMS 0.354, over the 0.24 boundary.
      expect(analyzeOnsets(sine(440, 2, 0.5), SR, { estimatePitch: false })
        .normalizationProfile).toBe("loud");
    });
  });

  it("reports monotonic progress that reaches 1", () => {
    const { mono } = clickTrain({ bpm: 120, seconds: 4 });
    const seen: number[] = [];
    analyzeOnsets(mono, SR, {
      progressEveryFrames: 32,
      onProgress: (p) => seen.push(p),
    });
    expect(seen.length).toBeGreaterThan(4);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]! - 1e-6);
      expect(seen[i]!).toBeLessThanOrEqual(1);
    }
    expect(seen[seen.length - 1]!).toBeCloseTo(1, 6);
  });

  it("survives a signal shorter than one analysis window", () => {
    // A 10 ms buffer has no valid frame at all; it must return an empty-ish
    // result rather than throw, because a truncated download can produce one.
    const result = analyzeOnsets(sine(440, 0.01), SR);
    expect(result.stats.onsetCount).toBe(0);
    expect(result.durationMs).toBeCloseTo(10, 0);
    expect(Number.isFinite(result.bpm)).toBe(true);
    expect(Number.isFinite(result.beatPhaseMs)).toBe(true);
  });

  it("works at 48 kHz as well as 44.1", () => {
    // Music-server files are commonly 48 kHz, and the hop is defined in samples.
    const { mono, clickTimesMs } = clickTrain({
      bpm: 120,
      seconds: 6,
      sampleRate: 48_000,
    });
    const result = analyzeOnsets(mono, 48_000, { estimatePitch: false });
    expect(result.bpm).toBeGreaterThan(119);
    expect(result.bpm).toBeLessThan(121);
    for (const e of onsetErrorsMs(result.events, clickTimesMs)) {
      expect(Math.abs(e)).toBeLessThanOrEqual(15);
    }
  });
});
