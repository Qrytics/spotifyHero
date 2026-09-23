/**
 * Analysis windows and the frame-index ↔ time mapping every other module in this
 * package agrees on.
 *
 * **Framing is centred**: frame `i` covers samples
 * `[i*hop - fftSize/2, i*hop + fftSize/2)`, zero-filled where that runs off
 * either end. So
 *
 *   timeMs(frame) = frame * hopSize / sampleRate * 1000
 *
 * That mapping is not cosmetic — it is the alignment this whole feature exists
 * to fix. For a transient at sample `t`, the half-wave-rectified flux peaks at
 * the frame whose window is *centred* on `t`: the Hann weight applied to the
 * transient is maximal there, so that frame's magnitude gain over its
 * predecessor is the largest. Centred framing therefore puts the flux peak at
 * exactly `t`, with no constant offset to subtract afterwards.
 *
 * Left-aligned framing (window = `[i*hop, i*hop + fftSize)`) would have needed a
 * `+fftSize/2` correction *and* would have made onsets inside the first
 * `fftSize` samples undetectable, because the flux at frame 0 is 0 by
 * definition. The cost of centring is that the first and last `fftSize/2`
 * samples (~23 ms at 44.1 kHz) are excluded from peak picking — see
 * `computeOnsetEnvelope`, which zeroes the flux there so the zero-padding ramp
 * cannot masquerade as an onset.
 *
 * With `hopSize = 512` at 44.1 kHz a peak localizes to ±5.8 ms before parabolic
 * interpolation — comfortably inside `DEFAULT_HIT_WINDOWS.perfect` (40 ms).
 */

/** Periodic Hann window (the STFT-correct variant, not the symmetric one). */
export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  }
  return w;
}

/** Frame geometry shared by the envelope pass, peak picking and the pitch pass. */
export interface FrameGeometry {
  readonly fftSize: number;
  readonly hopSize: number;
  readonly sampleRate: number;
  /** Milliseconds between frames. */
  readonly hopMs: number;
}

export function frameGeometry(
  fftSize: number,
  hopSize: number,
  sampleRate: number
): FrameGeometry {
  return {
    fftSize,
    hopSize,
    sampleRate,
    hopMs: (hopSize / sampleRate) * 1000,
  };
}

/**
 * Time of a frame, in ms. Accepts a fractional index so a parabolically
 * interpolated peak keeps its sub-hop precision.
 */
export function frameTimeMs(frame: number, geo: FrameGeometry): number {
  return frame * geo.hopMs;
}

/** Inverse of {@link frameTimeMs}, rounded to a real frame. */
export function frameAtTimeMs(timeMs: number, geo: FrameGeometry): number {
  return Math.round(timeMs / geo.hopMs);
}
