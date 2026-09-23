/**
 * The FFT's magnitude *scale* is the load-bearing property here, not just its
 * correctness: `pitch.ts` compares against an absolute `magnitudeFloor`
 * (0.004 ≈ −48 dBFS) that is only meaningful because a full-scale Hann-windowed
 * sine reads ~1.0 at its peak bin. A scale regression would silently make every
 * frame "pitchless" (or every frame pitched) rather than fail loudly.
 */
import { describe, expect, it } from "vitest";
import { Fft, binToHz, hzToBin } from "../fft.js";
import { hannWindow } from "../window.js";
import { SR, silence, sine } from "./signals.js";

describe("Fft", () => {
  it("rejects sizes that are not a power of two >= 4", () => {
    expect(() => new Fft(5)).toThrow(/power of two/);
    expect(() => new Fft(2)).toThrow(/power of two/);
    expect(() => new Fft(0)).toThrow(/power of two/);
    expect(new Fft(4).size).toBe(4);
  });

  it("reports DC..Nyquist as the usable bin count", () => {
    expect(new Fft(2048).binCount).toBe(1025);
    expect(new Fft(8).binCount).toBe(5);
  });

  it("spreads a unit impulse flat across every bin at the 4/N scale", () => {
    // An impulse transforms to a constant spectrum, so this isolates the
    // magnitude scaling from any windowing or leakage question.
    const n = 64;
    const fft = new Fft(n);
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    re[0] = 1;
    fft.transform(re, im);

    const mag = new Float32Array(fft.binCount);
    fft.magnitudes(re, im, mag);
    for (let k = 0; k < fft.binCount; k++) {
      expect(mag[k]!).toBeCloseTo(4 / n, 6);
    }
  });

  it("reads a Hann-windowed sine at its own amplitude, in the right bin", () => {
    const fftSize = 2048;
    const fft = new Fft(fftSize);
    const win = hannWindow(fftSize);
    // Exactly on a bin centre, so there is no leakage to reason about.
    const bin = 64;
    const hz = binToHz(bin, fftSize, SR);
    const amplitude = 0.5;
    const samples = sine(hz, fftSize / SR, amplitude);

    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = samples[i]! * win[i]!;
    fft.transform(re, im);

    const mag = new Float32Array(fft.binCount);
    fft.magnitudes(re, im, mag);

    let argmax = 0;
    for (let k = 1; k < fft.binCount; k++) {
      if (mag[k]! > mag[argmax]!) argmax = k;
    }
    expect(argmax).toBe(bin);
    // This is the number `magnitudeFloor` is calibrated against.
    expect(mag[bin]!).toBeCloseTo(amplitude, 2);
    // Hann's main lobe is 3 bins wide: the shoulders read half the peak.
    expect(mag[bin - 1]!).toBeCloseTo(amplitude / 2, 2);
    expect(mag[bin + 1]!).toBeCloseTo(amplitude / 2, 2);
  });

  it("leaves silence at zero", () => {
    const fftSize = 256;
    const fft = new Fft(fftSize);
    const re = Float32Array.from(silence(fftSize / SR, SR).subarray(0, fftSize));
    const im = new Float32Array(fftSize);
    fft.transform(re, im);
    const mag = new Float32Array(fft.binCount);
    fft.magnitudes(re, im, mag);
    for (let k = 0; k < fft.binCount; k++) expect(mag[k]!).toBe(0);
  });
});

describe("bin <-> hz", () => {
  it("round-trips", () => {
    expect(binToHz(0, 2048, SR)).toBe(0);
    expect(binToHz(1024, 2048, SR)).toBeCloseTo(SR / 2, 6);
    expect(hzToBin(binToHz(37, 2048, SR), 2048, SR)).toBe(37);
  });
});
