/**
 * Synthetic test signals. Deterministic — no randomness anywhere, so a failure
 * is always a real failure.
 */

export const SR = 44100;

export interface ClickTrainOptions {
  bpm: number;
  seconds: number;
  sampleRate?: number;
  amplitude?: number;
  /** Where the first click starts. Deliberately not 0: the first ~23 ms of a
   *  signal are excluded from peak picking (centred framing, see `window.ts`). */
  firstClickMs?: number;
  clickHz?: number;
  clickMs?: number;
  decayMs?: number;
}

export interface ClickTrain {
  mono: Float32Array;
  clickTimesMs: number[];
  sampleRate: number;
}

/**
 * Percussive clicks on silence: a short exponentially-decaying sine, which has
 * the sharp attack spectral flux keys on.
 */
export function clickTrain(opts: ClickTrainOptions): ClickTrain {
  const sampleRate = opts.sampleRate ?? SR;
  const amplitude = opts.amplitude ?? 0.9;
  const firstClickMs = opts.firstClickMs ?? 250;
  const clickHz = opts.clickHz ?? 1200;
  const clickMs = opts.clickMs ?? 12;
  const decayMs = opts.decayMs ?? 4;

  const n = Math.round(opts.seconds * sampleRate);
  const mono = new Float32Array(n);
  const periodMs = 60_000 / opts.bpm;
  const clickSamples = Math.round((clickMs / 1000) * sampleRate);
  const decaySamples = (decayMs / 1000) * sampleRate;

  const clickTimesMs: number[] = [];
  for (let t = firstClickMs; t < opts.seconds * 1000; t += periodMs) {
    const start = Math.round((t / 1000) * sampleRate);
    if (start + clickSamples >= n) break;
    clickTimesMs.push(t);
    for (let i = 0; i < clickSamples; i++) {
      const env = Math.exp(-i / decaySamples);
      mono[start + i] =
        mono[start + i]! +
        amplitude * env * Math.sin((2 * Math.PI * clickHz * i) / sampleRate);
    }
  }
  return { mono, clickTimesMs, sampleRate };
}

/** Steady sine, full length. */
export function sine(
  hz: number,
  seconds: number,
  amplitude = 0.5,
  sampleRate = SR
): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return out;
}

/** Band-limited sawtooth by additive synthesis — harmonics fall off as 1/h. */
export function sawtooth(
  hz: number,
  seconds: number,
  amplitude = 0.5,
  sampleRate = SR,
  harmonics = 10
): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const nyquist = sampleRate / 2;
  for (let h = 1; h <= harmonics; h++) {
    const f = hz * h;
    if (f >= nyquist) break;
    const gain = amplitude / h;
    for (let i = 0; i < n; i++) {
      out[i] = out[i]! + gain * Math.sin((2 * Math.PI * f * i) / sampleRate);
    }
  }
  return out;
}

export function silence(seconds: number, sampleRate = SR): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

/** Mean of `xs`. */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
