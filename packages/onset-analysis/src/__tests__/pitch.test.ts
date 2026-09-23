/**
 * `pitchHz` is a hint, not a transcription — but two things about it are worth
 * pinning down: the octave error (picking the second partial as the fundamental)
 * and the absolute magnitude floor that decides a frame is pitchless. Both are
 * silent failures in a chart: wrong synthesis frequencies, or none at all.
 */
import { describe, expect, it } from "vitest";
import { PitchEstimator } from "../pitch.js";
import { SR, sawtooth, silence, sine } from "./signals.js";

const FFT_SIZE = 2048;

function estimatorFor(opts = {}) {
  return new PitchEstimator(FFT_SIZE, SR, opts);
}

describe("PitchEstimator", () => {
  it("reads a sine within a few Hz, well inside one bin", () => {
    // A bin is 21.5 Hz here, so anything close to 440 proves the parabolic
    // interpolation is doing its job rather than just reporting a bin centre.
    const hz = estimatorFor().estimateHz(sine(440, 0.5), SR * 0.25);
    expect(hz).not.toBeNull();
    expect(hz!).toBeGreaterThan(432);
    expect(hz!).toBeLessThan(448);
  });

  it("picks the fundamental of a harmonic-rich tone, not its octave", () => {
    // The classic failure: 440 instead of 220. The 1/h-weighted harmonic sum is
    // what prevents it — the real fundamental collects support from every
    // partial, the second partial only from every other one.
    const hz = estimatorFor().estimateHz(sawtooth(220, 0.5), SR * 0.25);
    expect(hz).not.toBeNull();
    expect(hz!).toBeGreaterThan(212);
    expect(hz!).toBeLessThan(228);
  });

  it("tracks a different note", () => {
    const hz = estimatorFor().estimateHz(sawtooth(110, 0.5), SR * 0.25);
    expect(hz).not.toBeNull();
    // Below ~100 Hz a bin is a large fraction of a semitone; allow a wider band
    // here, as the module's own comment says to.
    expect(hz!).toBeGreaterThan(100);
    expect(hz!).toBeLessThan(122);
  });

  it("returns null for silence", () => {
    expect(estimatorFor().estimateHz(silence(0.5), SR * 0.25)).toBeNull();
  });

  it("returns null below the absolute magnitude floor", () => {
    // −60 dBFS, under the 0.004 (≈ −48 dBFS) floor: pitchless, not "quietly
    // pitched". The floor is absolute because magnitudes are scale-normalized.
    expect(estimatorFor().estimateHz(sine(440, 0.5, 0.001), SR * 0.25)).toBeNull();
    // ...and the same tone at a normal level is not.
    expect(estimatorFor().estimateHz(sine(440, 0.5, 0.5), SR * 0.25)).not.toBeNull();
  });

  it("ignores content outside [minHz, maxHz]", () => {
    const narrow = estimatorFor({ minHz: 500, maxHz: 1600 });
    // 220 Hz sine, but only 500-1600 Hz is considered. A harmonic-free sine has
    // nothing up there, so there is no peak to accept.
    expect(narrow.estimateHz(sine(220, 0.5), SR * 0.25)).toBeNull();
  });

  it("handles a window that runs off the start of the signal", () => {
    // Zero-padded rather than out of bounds: the first onset in a track can sit
    // inside the first half-window.
    const hz = estimatorFor().estimateHz(sine(440, 0.5), 8);
    expect(hz === null || (hz > 300 && hz < 600)).toBe(true);
  });

  it("is reusable across calls without cross-contamination", () => {
    const est = estimatorFor();
    const a = est.estimateHz(sine(440, 0.5), SR * 0.25);
    const quiet = est.estimateHz(silence(0.5), SR * 0.25);
    const b = est.estimateHz(sine(440, 0.5), SR * 0.25);
    expect(quiet).toBeNull();
    expect(b).toBe(a);
  });
});
