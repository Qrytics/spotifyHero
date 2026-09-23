/**
 * Pass 1. Two properties matter more than the flux values themselves:
 *
 *  - the flux peak for a transient lands within a hop of the transient (this is
 *    the alignment the whole feature exists for), and
 *  - `amplitude` / `rms` are **absolute**. The chart generator's silence gate
 *    compares them to fixed thresholds, so a per-track normalization sneaking in
 *    here would hand every intro and outro a full chart. Scaling the input must
 *    scale these outputs.
 */
import { describe, expect, it } from "vitest";
import { computeOnsetEnvelope } from "../spectralFlux.js";
import { frameTimeMs } from "../window.js";
import { SR, clickTrain, silence, sine } from "./signals.js";

/** Index of the largest value in `[centre - half, centre + half]`. */
function argmaxNear(values: Float32Array, centre: number, half: number): number {
  const lo = Math.max(0, centre - half);
  const hi = Math.min(values.length - 1, centre + half);
  let best = lo;
  for (let i = lo; i <= hi; i++) {
    if (values[i]! > values[best]!) best = i;
  }
  return best;
}

function maxOf(values: Float32Array): number {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m;
}

describe("computeOnsetEnvelope", () => {
  it("peaks within one hop of each click", () => {
    const { mono, clickTimesMs } = clickTrain({ bpm: 120, seconds: 6 });
    const env = computeOnsetEnvelope(mono, SR);

    // A click on silence is the easiest possible onset: every one must be found,
    // and none may be more than a hop away. The sign of the error is allowed to
    // be negative — with a silent baseline, log-compressed flux peaks at the
    // first frame whose window catches the transient, which is up to one hop
    // early. It is systematic, so `serverPlaybackTimingOffsetMs` absorbs it.
    for (const clickMs of clickTimesMs) {
      const expected = Math.round(clickMs / env.geo.hopMs);
      const frame = argmaxNear(env.flux, expected, 3);
      const errorMs = frameTimeMs(frame, env.geo) - clickMs;
      expect(Math.abs(errorMs)).toBeLessThanOrEqual(env.geo.hopMs + 3);
      expect(env.flux[frame]!).toBeGreaterThan(0);
    }
  });

  it("zeroes the flux where the window is zero-padded", () => {
    const { mono } = clickTrain({ bpm: 120, seconds: 3 });
    const env = computeOnsetEnvelope(mono, SR);

    expect(env.firstValidFrame).toBe(2); // ceil((2048/2) / 512)
    for (let f = 0; f < env.firstValidFrame; f++) expect(env.flux[f]!).toBe(0);
    for (let f = env.lastValidFrame + 1; f < env.frameCount; f++) {
      expect(env.flux[f]!).toBe(0);
    }
    // ...but the level series are still populated out there.
    expect(env.amplitude.length).toBe(env.frameCount);
  });

  it("keeps amplitude and rms absolute, never per-track normalized", () => {
    const loud = clickTrain({ bpm: 120, seconds: 3, amplitude: 0.8 });
    const quiet = Float32Array.from(loud.mono, (v) => v * 0.25);

    const a = computeOnsetEnvelope(loud.mono, SR);
    const b = computeOnsetEnvelope(quiet, SR);

    // Exactly a quarter, not "the same shape re-normalized".
    expect(maxOf(b.amplitude)).toBeCloseTo(maxOf(a.amplitude) * 0.25, 4);
    expect(maxOf(b.rms)).toBeCloseTo(maxOf(a.rms) * 0.25, 4);
  });

  it("measures rms of a steady sine at its analytic value", () => {
    const env = computeOnsetEnvelope(sine(440, 1, 0.5), SR);
    // A 0.5-amplitude sine has RMS 0.5/√2. Checked mid-signal, away from the
    // zero-padded ends.
    const mid = Math.floor(env.frameCount / 2);
    expect(env.rms[mid]!).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(env.amplitude[mid]!).toBeCloseTo(0.5, 2);
  });

  it("finds nothing in silence", () => {
    const env = computeOnsetEnvelope(silence(2), SR);
    expect(maxOf(env.flux)).toBe(0);
    expect(maxOf(env.amplitude)).toBe(0);
    expect(maxOf(env.rms)).toBe(0);
  });

  it("reports monotonic progress ending at 1", () => {
    const seen: number[] = [];
    computeOnsetEnvelope(sine(440, 2), SR, {
      progressEveryFrames: 16,
      onProgress: (p) => seen.push(p),
    });
    expect(seen.length).toBeGreaterThan(4);
    expect(seen[0]!).toBeGreaterThan(0);
    expect(seen[seen.length - 1]!).toBeCloseTo(1, 6);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it("honours a custom hop size in its geometry", () => {
    const env = computeOnsetEnvelope(sine(440, 1), SR, { fftSize: 1024, hopSize: 256 });
    expect(env.geo.fftSize).toBe(1024);
    expect(env.geo.hopMs).toBeCloseTo((256 / SR) * 1000, 6);
    expect(env.firstValidFrame).toBe(2);
  });
});
