/**
 * Pass 2: fundamental frequency at the frames that turned out to be onsets.
 *
 * Runs one extra FFT per onset (a few hundred per track, against ~20,700 in
 * pass 1) which is why `spectralFlux.ts` is free to throw its spectra away.
 *
 * `pitchHz` is a **hint**, not a transcription: the chart generator uses
 * step-to-step change to detect melodic motion and to pick a synthesis
 * frequency for manual hits. At `fftSize = 2048` / 44.1 kHz a bin is 21.5 Hz, so
 * a bass fundamental sits between bins and only parabolic interpolation makes
 * the number meaningful at all. Relative motion survives that; absolute
 * accuracy below ~100 Hz does not.
 *
 * Candidates come only from observed spectral peaks, and each is scored by a
 * `1/h`-weighted harmonic sum. That ordering is what avoids the classic octave
 * error: a true fundamental collects support from every harmonic, while its
 * second partial mistaken for a fundamental only collects every other one.
 */
import { Fft } from "./fft.js";
import { hannWindow } from "./window.js";

export interface PitchEstimatorOptions {
  /** Lowest fundamental considered. */
  minHz?: number;
  /** Highest fundamental considered. */
  maxHz?: number;
  /** Harmonics summed when scoring a candidate. */
  harmonics?: number;
  /**
   * Frames whose strongest bin is below this are treated as pitchless.
   * Magnitudes are normalized so a full-scale sine peaks at ~1.0, so this is a
   * track-independent absolute floor (0.004 ≈ −48 dBFS).
   */
  magnitudeFloor?: number;
  /** A candidate peak must reach this fraction of the frame's strongest bin. */
  peakFraction?: number;
}

export class PitchEstimator {
  private readonly fft: Fft;
  private readonly win: Float32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly mag: Float32Array;

  private readonly fftSize: number;
  private readonly binHz: number;
  private readonly minHz: number;
  private readonly maxHz: number;
  private readonly harmonics: number;
  private readonly magnitudeFloor: number;
  private readonly peakFraction: number;

  constructor(
    fftSize: number,
    sampleRate: number,
    opts: PitchEstimatorOptions = {}
  ) {
    this.fftSize = fftSize;
    this.binHz = sampleRate / fftSize;
    this.minHz = opts.minHz ?? 55;
    this.maxHz = opts.maxHz ?? 1600;
    this.harmonics = Math.max(1, opts.harmonics ?? 6);
    this.magnitudeFloor = opts.magnitudeFloor ?? 0.004;
    this.peakFraction = opts.peakFraction ?? 0.1;

    this.fft = new Fft(fftSize);
    this.win = hannWindow(fftSize);
    this.re = new Float32Array(fftSize);
    this.im = new Float32Array(fftSize);
    this.mag = new Float32Array(this.fft.binCount);
  }

  /**
   * Fundamental at a window **centred** on `centreSample`, matching the framing
   * in `window.ts`. Returns null when the frame is too quiet or has no usable
   * peak.
   */
  estimateHz(mono: Float32Array, centreSample: number): number | null {
    const { fftSize, re, im, win, mag, fft } = this;
    const half = fftSize >>> 1;
    const start = Math.round(centreSample) - half;
    const n = mono.length;

    re.fill(0);
    im.fill(0);
    const lo = start < 0 ? 0 : start;
    const hi = start + fftSize > n ? n : start + fftSize;
    for (let idx = lo; idx < hi; idx++) {
      re[idx - start] = mono[idx]! * win[idx - start]!;
    }

    fft.transform(re, im);
    fft.magnitudes(re, im, mag);

    const binCount = fft.binCount;
    let globalMax = 0;
    for (let k = 1; k < binCount; k++) {
      if (mag[k]! > globalMax) globalMax = mag[k]!;
    }
    if (globalMax < this.magnitudeFloor) return null;

    const minBin = Math.max(1, Math.floor(this.minHz / this.binHz));
    const maxBin = Math.min(binCount - 2, Math.ceil(this.maxHz / this.binHz));
    const threshold = globalMax * this.peakFraction;

    let bestBin = -1;
    let bestScore = 0;
    for (let k = minBin; k <= maxBin; k++) {
      const v = mag[k]!;
      if (v < threshold) continue;
      if (v < mag[k - 1]! || v < mag[k + 1]!) continue; // local peak only
      const score = this.harmonicScore(k);
      if (score > bestScore) {
        bestScore = score;
        bestBin = k;
      }
    }
    if (bestBin < 0) return null;

    const hz = (bestBin + logParabolicShift(mag, bestBin)) * this.binHz;
    if (!Number.isFinite(hz) || hz <= 0) return null;
    return hz;
  }

  /** `1/h`-weighted sum of the strongest bin within ±1 of each harmonic. */
  private harmonicScore(fundamentalBin: number): number {
    const { mag, fft, harmonics } = this;
    const binCount = fft.binCount;
    let score = 0;
    for (let h = 1; h <= harmonics; h++) {
      const centre = fundamentalBin * h;
      if (centre >= binCount - 1) break;
      let best = 0;
      const lo = centre - 1 < 0 ? 0 : centre - 1;
      const hi = centre + 1 >= binCount ? binCount - 1 : centre + 1;
      for (let k = lo; k <= hi; k++) {
        if (mag[k]! > best) best = mag[k]!;
      }
      score += best / h;
    }
    return score;
  }
}

/**
 * Sub-bin peak position from a parabola through log-magnitudes — the standard
 * refinement for a Hann-windowed peak, accurate to a small fraction of a bin.
 */
function logParabolicShift(mag: Float32Array, k: number): number {
  if (k <= 0 || k + 1 >= mag.length) return 0;
  const eps = 1e-12;
  const a = Math.log(mag[k - 1]! + eps);
  const b = Math.log(mag[k]! + eps);
  const c = Math.log(mag[k + 1]! + eps);
  const denom = a - 2 * b + c;
  if (denom >= 0) return 0;
  const shift = (0.5 * (a - c)) / denom;
  if (!Number.isFinite(shift)) return 0;
  return shift < -0.5 ? -0.5 : shift > 0.5 ? 0.5 : shift;
}
