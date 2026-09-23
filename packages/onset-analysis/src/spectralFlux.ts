/**
 * Pass 1 of the analysis: one STFT sweep producing three per-frame series.
 *
 * Deliberately does **not** keep the magnitude spectra. A 4-minute track is
 * ~20,700 frames × 1025 bins × 4 bytes ≈ 85 MB, which would sit on top of the
 * ~92 MB `AudioBuffer` the player is already holding. Pitch estimation instead
 * re-runs an FFT at the few hundred frames that turned out to be onsets
 * (`pitch.ts`), which costs ~1 % of this pass.
 *
 * `amplitude` and `rms` are **absolute, never per-track normalized**. The chart
 * generator's `applySilenceGate` compares them against fixed thresholds
 * (`enterAmplitude: 0.045`), so normalizing here would make every track look
 * equally loud and hand intros and outros a full complement of notes.
 */
import { Fft } from "./fft.js";
import { frameGeometry, hannWindow, type FrameGeometry } from "./window.js";

/**
 * Magnitudes are log-compressed before differencing, so a snare over a loud mix
 * counts as much as the same snare over a quiet one. Standard range is 1–100;
 * 20 keeps a full-scale sine's compressed value near 3.
 */
export const LOG_COMPRESSION_GAMMA = 20;

export interface OnsetEnvelope {
  readonly geo: FrameGeometry;
  readonly frameCount: number;
  /**
   * Half-wave-rectified spectral flux over log-compressed magnitudes, mean over
   * bins. Raw — normalization happens where confidence is assigned.
   *
   * Forced to 0 outside `[firstValidFrame, lastValidFrame]` so the zero-padding
   * ramp at each end of the signal cannot look like an onset.
   */
  readonly flux: Float32Array;
  /** Peak `|sample|` in the frame's window. Absolute. */
  readonly amplitude: Float32Array;
  /** RMS over the frame's window. Absolute. */
  readonly rms: Float32Array;
  readonly firstValidFrame: number;
  readonly lastValidFrame: number;
}

export interface OnsetEnvelopeOptions {
  fftSize?: number;
  hopSize?: number;
  /** Called with 0..1 every `progressEveryFrames` frames. */
  onProgress?: (progress: number) => void;
  progressEveryFrames?: number;
}

export function computeOnsetEnvelope(
  mono: Float32Array,
  sampleRate: number,
  opts: OnsetEnvelopeOptions = {}
): OnsetEnvelope {
  const fftSize = opts.fftSize ?? 2048;
  const hopSize = opts.hopSize ?? 512;
  const progressEvery = Math.max(1, opts.progressEveryFrames ?? 256);
  const geo = frameGeometry(fftSize, hopSize, sampleRate);

  const n = mono.length;
  const half = fftSize >>> 1;
  const frameCount = Math.max(1, Math.floor(n / hopSize) + 1);

  const flux = new Float32Array(frameCount);
  const amplitude = new Float32Array(frameCount);
  const rms = new Float32Array(frameCount);

  // Frames whose window lies entirely inside the signal. Outside this range the
  // window is zero-padded, which produces a purely synthetic energy ramp.
  const firstValidFrame = Math.ceil(half / hopSize);
  const lastValidFrame = Math.floor((n - half) / hopSize);

  const fft = new Fft(fftSize);
  const win = hannWindow(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const mag = new Float32Array(fft.binCount);
  const compressed = new Float32Array(fft.binCount);
  const prevCompressed = new Float32Array(fft.binCount);
  let havePrev = false;

  const binCount = fft.binCount;
  const invBinCount = 1 / binCount;

  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopSize - half;

    // --- window + level (absolute, over the part of the window that exists) --
    const lo = start < 0 ? 0 : start;
    const hi = start + fftSize > n ? n : start + fftSize;
    re.fill(0);
    im.fill(0);
    let peak = 0;
    let sumSquares = 0;
    for (let idx = lo; idx < hi; idx++) {
      const sample = mono[idx]!;
      const abs = sample < 0 ? -sample : sample;
      if (abs > peak) peak = abs;
      sumSquares += sample * sample;
      re[idx - start] = sample * win[idx - start]!;
    }
    const counted = hi - lo;
    amplitude[frame] = peak > 1 ? 1 : peak;
    const frameRms = counted > 0 ? Math.sqrt(sumSquares / counted) : 0;
    rms[frame] = frameRms > 1 ? 1 : frameRms;

    // --- flux -------------------------------------------------------------
    fft.transform(re, im);
    fft.magnitudes(re, im, mag);
    for (let k = 0; k < binCount; k++) {
      compressed[k] = Math.log1p(LOG_COMPRESSION_GAMMA * mag[k]!);
    }
    if (havePrev) {
      let sum = 0;
      for (let k = 0; k < binCount; k++) {
        const d = compressed[k]! - prevCompressed[k]!;
        if (d > 0) sum += d;
      }
      flux[frame] =
        frame >= firstValidFrame && frame <= lastValidFrame
          ? sum * invBinCount
          : 0;
    }
    prevCompressed.set(compressed);
    havePrev = true;

    if (opts.onProgress && (frame % progressEvery === 0 || frame === frameCount - 1)) {
      opts.onProgress((frame + 1) / frameCount);
    }
  }

  return {
    geo,
    frameCount,
    flux,
    amplitude,
    rms,
    firstValidFrame,
    lastValidFrame,
  };
}
