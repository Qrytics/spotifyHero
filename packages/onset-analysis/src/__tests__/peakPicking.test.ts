/**
 * Peak picking is tested against hand-built flux arrays rather than audio: the
 * three conditions (local max, running median, absolute floor) and the
 * minimum-separation rule are pure array logic, and a synthetic envelope makes a
 * failure point straight at the rule that broke.
 */
import { describe, expect, it } from "vitest";
import { parabolicShift, percentileOf, pickPeaks } from "../peakPicking.js";

/** Flat baseline with spikes at the given frames. */
function envelope(
  length: number,
  baseline: number,
  spikes: ReadonlyArray<readonly [frame: number, value: number]>
): Float32Array {
  const flux = new Float32Array(length).fill(baseline);
  for (const [frame, value] of spikes) flux[frame] = value;
  return flux;
}

describe("pickPeaks", () => {
  it("finds isolated spikes and ignores the baseline", () => {
    const flux = envelope(200, 0.01, [
      [50, 1],
      [120, 0.8],
    ]);
    const { peaks } = pickPeaks(flux);
    expect(peaks.map((p) => p.frame)).toEqual([50, 120]);
    expect(peaks[0]!.strength).toBeCloseTo(1, 6);
    expect(peaks[0]!.localMedian).toBeCloseTo(0.01, 6);
  });

  it("keeps the stronger of two peaks closer than minSeparationFrames", () => {
    // 100 and 103 are 3 frames apart, inside the default separation of 4.
    const { peaks } = pickPeaks(
      envelope(200, 0.01, [
        [100, 1],
        [103, 0.5],
      ])
    );
    expect(peaks.map((p) => p.frame)).toEqual([100]);
  });

  it("replaces an accepted peak when the later one is stronger", () => {
    const { peaks } = pickPeaks(
      envelope(200, 0.01, [
        [100, 0.5],
        [102, 1],
      ])
    );
    expect(peaks.map((p) => p.frame)).toEqual([102]);
    expect(peaks[0]!.strength).toBeCloseTo(1, 6);
  });

  it("resolves a plateau to its first frame", () => {
    const { peaks } = pickPeaks(
      envelope(200, 0.01, [
        [60, 1],
        [61, 1],
      ])
    );
    expect(peaks.map((p) => p.frame)).toEqual([60]);
  });

  it("rejects a bump that does not clear the running median", () => {
    // A dense ramp of near-equal values: nothing stands above its neighbourhood.
    const flux = new Float32Array(200);
    for (let i = 0; i < flux.length; i++) flux[i] = 0.5 + 0.001 * (i % 3);
    const { peaks } = pickPeaks(flux);
    expect(peaks).toHaveLength(0);
  });

  it("rejects noise in near-silence, where the median is numerically tiny", () => {
    // This is what the absolute delta floor is for: a 1e-7 median would let a
    // 1e-6 wobble clear `median * 1.6` on its own.
    const flux = envelope(200, 1e-7, [[80, 1]]);
    const loud = pickPeaks(flux);
    expect(loud.peaks.map((p) => p.frame)).toEqual([80]);

    const wobble = new Float32Array(200);
    for (let i = 0; i < wobble.length; i++) wobble[i] = i % 2 === 0 ? 1e-7 : 3e-7;
    // Every other frame sits 3x above the median here — the median test alone
    // would accept 100 onsets out of noise. Nothing may come out of an envelope
    // with no structure.
    expect(pickPeaks(wobble).peaks).toHaveLength(0);
  });

  it("finds nothing in an all-zero envelope", () => {
    expect(pickPeaks(new Float32Array(200)).peaks).toHaveLength(0);
  });

  it("reports the flux scale confidence is mapped against", () => {
    const { fluxMedian, fluxP95 } = pickPeaks(envelope(200, 0.02, [[50, 1]]));
    expect(fluxMedian).toBeCloseTo(0.02, 6);
    // One spike in 200 frames does not reach the 95th percentile.
    expect(fluxP95).toBeCloseTo(0.02, 6);
  });
});

describe("parabolicShift", () => {
  it("is zero for a symmetric peak", () => {
    expect(parabolicShift(Float32Array.from([0.5, 1, 0.5]), 1)).toBeCloseTo(0, 9);
  });

  it("leans toward the taller shoulder", () => {
    expect(parabolicShift(Float32Array.from([0.4, 1, 0.6]), 1)).toBeCloseTo(0.1, 6);
    expect(parabolicShift(Float32Array.from([0.6, 1, 0.4]), 1)).toBeCloseTo(-0.1, 6);
  });

  it("returns 0 where the curvature is not a maximum", () => {
    expect(parabolicShift(Float32Array.from([1, 1, 1]), 1)).toBe(0);
    expect(parabolicShift(Float32Array.from([0, 1, 5]), 1)).toBe(0);
  });

  it("never exceeds half a frame", () => {
    const shift = parabolicShift(Float32Array.from([0.999, 1, 0.001]), 1);
    expect(shift).toBeGreaterThanOrEqual(-0.5);
    expect(shift).toBeLessThanOrEqual(0.5);
  });
});

describe("percentileOf", () => {
  const ramp = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("spans min to max", () => {
    expect(percentileOf(ramp, 0)).toBe(0);
    expect(percentileOf(ramp, 1)).toBe(9);
  });

  it("picks the nearest rank for the median", () => {
    expect(percentileOf(ramp, 0.5)).toBe(5);
  });

  it("sorts numerically, not lexicographically", () => {
    // `Array.prototype.sort` would order these 10, 2, 9 — a TypedArray must not.
    expect(percentileOf(Float32Array.from([10, 2, 9]), 1)).toBe(10);
  });

  it("is 0 for an empty series", () => {
    expect(percentileOf(new Float32Array(0), 0.5)).toBe(0);
  });
});
