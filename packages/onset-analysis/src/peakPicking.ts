/**
 * Adaptive peak picking over the spectral-flux envelope.
 *
 * Three conditions, all standard (Dixon 2006), all necessary here:
 *  - **local maximum** over ±2 frames, so the shoulders of one transient do not
 *    each become an onset;
 *  - **above a running median** of the surrounding ~280 ms, so a loud chorus
 *    does not carpet-bomb the chart while a sparse verse gets nothing — this is
 *    what makes the detector work on one track without per-track tuning;
 *  - **above an absolute floor** tied to the track's own 95th-percentile flux,
 *    so near-silence with a numerically tiny median cannot clear the median test
 *    on noise alone.
 *
 * The running median is evaluated only at local maxima (a few hundred frames),
 * not at all ~20,700, which makes its cost irrelevant.
 */

export interface OnsetPeak {
  /** Frame index the flux peaked at. */
  readonly frame: number;
  /** Sub-hop refinement in frames, within (-0.5, 0.5). */
  readonly frameShift: number;
  /** Raw flux at the peak. */
  readonly strength: number;
  /** Running median around the peak — the baseline `strength` had to beat. */
  readonly localMedian: number;
}

export interface PeakPickingOptions {
  /** Half-width of the running-median window, in frames (12 ≈ ±140 ms). */
  medianHalfWidthFrames?: number;
  /** A peak must exceed `localMedian * medianMultiplier + delta`. */
  medianMultiplier?: number;
  /** `delta`, as a fraction of the track's 95th-percentile flux. */
  deltaFraction?: number;
  /** A peak must be the maximum over ±this many frames. */
  localMaxHalfWidthFrames?: number;
  /** Minimum frames between accepted peaks; the stronger one wins. */
  minSeparationFrames?: number;
}

export interface PeakPickingResult {
  readonly peaks: OnsetPeak[];
  /** 95th percentile of the whole flux series — the scale confidence maps onto. */
  readonly fluxP95: number;
  /** Median of the whole flux series. */
  readonly fluxMedian: number;
}

export function pickPeaks(
  flux: Float32Array,
  opts: PeakPickingOptions = {}
): PeakPickingResult {
  const medianHalf = Math.max(1, opts.medianHalfWidthFrames ?? 12);
  const medianMultiplier = opts.medianMultiplier ?? 1.6;
  const deltaFraction = opts.deltaFraction ?? 0.06;
  const localMaxHalf = Math.max(1, opts.localMaxHalfWidthFrames ?? 2);
  const minSeparation = Math.max(1, opts.minSeparationFrames ?? 4);

  const fluxMedian = percentileOf(flux, 0.5);
  const fluxP95 = percentileOf(flux, 0.95);
  const delta = deltaFraction * fluxP95;

  const n = flux.length;
  const scratch = new Float32Array(2 * medianHalf + 1);
  const accepted: OnsetPeak[] = [];

  for (let i = 1; i < n - 1; i++) {
    const v = flux[i]!;
    if (v <= 0) continue;

    let isLocalMax = true;
    const lo = i - localMaxHalf < 0 ? 0 : i - localMaxHalf;
    const hi = i + localMaxHalf >= n ? n - 1 : i + localMaxHalf;
    for (let j = lo; j <= hi; j++) {
      if (j === i) continue;
      // `>` on the left, `>=` on the right: a plateau resolves to its first frame.
      if (j < i ? flux[j]! >= v : flux[j]! > v) {
        isLocalMax = false;
        break;
      }
    }
    if (!isLocalMax) continue;

    const localMedian = windowMedian(flux, i, medianHalf, scratch);
    if (v < localMedian * medianMultiplier + delta) continue;

    const peak: OnsetPeak = {
      frame: i,
      frameShift: parabolicShift(flux, i),
      strength: v,
      localMedian,
    };

    const last = accepted[accepted.length - 1];
    if (last && i - last.frame < minSeparation) {
      if (v > last.strength) accepted[accepted.length - 1] = peak;
      continue;
    }
    accepted.push(peak);
  }

  return { peaks: accepted, fluxP95, fluxMedian };
}

/**
 * Sub-hop peak location from a parabola through the three samples around the
 * maximum. Returns 0 when the curvature is not a maximum (flat or noisy).
 */
export function parabolicShift(values: Float32Array, i: number): number {
  const a = i - 1 >= 0 ? values[i - 1]! : 0;
  const b = values[i]!;
  const c = i + 1 < values.length ? values[i + 1]! : 0;
  const denom = a - 2 * b + c;
  if (denom >= 0) return 0;
  const shift = (0.5 * (a - c)) / denom;
  if (!Number.isFinite(shift)) return 0;
  return shift < -0.5 ? -0.5 : shift > 0.5 ? 0.5 : shift;
}

/** Median of `values[i-half .. i+half]`, clamped to the array. */
function windowMedian(
  values: Float32Array,
  i: number,
  half: number,
  scratch: Float32Array
): number {
  const lo = i - half < 0 ? 0 : i - half;
  const hi = i + half >= values.length ? values.length - 1 : i + half;
  let count = 0;
  for (let j = lo; j <= hi; j++) {
    // Insertion sort as we copy — the window is ~25 wide, so this beats sort().
    const v = values[j]!;
    let k = count - 1;
    while (k >= 0 && scratch[k]! > v) {
      scratch[k + 1] = scratch[k]!;
      k--;
    }
    scratch[k + 1] = v;
    count++;
  }
  if (count === 0) return 0;
  const mid = count >>> 1;
  return count % 2 === 1
    ? scratch[mid]!
    : (scratch[mid - 1]! + scratch[mid]!) / 2;
}

/** `p` in 0..1. Copies and sorts; called a handful of times per track. */
export function percentileOf(values: Float32Array, p: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values);
  sorted.sort();
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(p * (sorted.length - 1)))
  );
  return sorted[idx]!;
}
