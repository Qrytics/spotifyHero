/**
 * Iterative radix-2 complex FFT with preallocated twiddle and bit-reversal
 * tables.
 *
 * Why hand-rolled rather than `OfflineAudioContext`: there is no spectral-flux
 * node, and wrapping the DSP in an `AudioWorklet` would make it untestable in
 * node. This file is the reason `onset-analysis` compiles with `lib: ["ES2022"]`
 * — no DOM, no Web Audio, just numbers.
 *
 * A 4-minute track is ~20,700 frames of 2048 points, so `transform()` is the
 * hot loop of the whole feature. It allocates nothing and is called with
 * caller-owned scratch arrays.
 */

export class Fft {
  readonly size: number;
  /** Number of usable magnitude bins: DC through Nyquist. */
  readonly binCount: number;

  /** Twiddles in Float64 — the data stays Float32, the tables should not. */
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 4 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two >= 4 (got ${size})`);
    }
    this.size = size;
    this.binCount = (size >>> 1) + 1;

    const half = size >>> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }

    const bits = Math.round(Math.log2(size));
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>>= 1;
      }
      this.reverse[i] = r >>> 0;
    }
  }

  /**
   * In-place forward transform. `re` and `im` must both be `size` long; `im` is
   * normally all zeros for real input.
   */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.size;
    const rev = this.reverse;

    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const half = len >>> 1;
      const stride = n / len;
      for (let base = 0; base < n; base += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * stride;
          const c = this.cosTable[tw]!;
          const s = this.sinTable[tw]!;
          const a = base + k;
          const b = a + half;
          const br = re[b]!;
          const bi = im[b]!;
          const tr = br * c - bi * s;
          const ti = br * s + bi * c;
          re[b] = re[a]! - tr;
          im[b] = im[a]! - ti;
          re[a] = re[a]! + tr;
          im[a] = im[a]! + ti;
        }
      }
    }
  }

  /**
   * Magnitude spectrum for bins 0..Nyquist, scaled so a full-scale sine under a
   * Hann window reads ~1.0 at its peak bin. Scale-independence is what lets
   * pitch detection use one absolute magnitude floor for every track.
   *
   * `out` must be at least `binCount` long.
   */
  magnitudes(re: Float32Array, im: Float32Array, out: Float32Array): void {
    // Hann halves the coherent gain, so a unit sine's peak bin is N/4.
    const scale = 4 / this.size;
    for (let k = 0; k < this.binCount; k++) {
      const r = re[k]!;
      const i = im[k]!;
      out[k] = Math.sqrt(r * r + i * i) * scale;
    }
  }
}

/** Hz at the centre of bin `k`. */
export function binToHz(bin: number, fftSize: number, sampleRate: number): number {
  return (bin * sampleRate) / fftSize;
}

/** Nearest bin to `hz` (may exceed `binCount` — callers range-check). */
export function hzToBin(hz: number, fftSize: number, sampleRate: number): number {
  return Math.round((hz * fftSize) / sampleRate);
}
