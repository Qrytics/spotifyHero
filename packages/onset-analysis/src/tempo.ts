/**
 * Tempo and beat phase from the onset envelope.
 *
 * Both outputs matter, and the second one is the easy one to forget:
 * `buildRhythmContext` takes `beatTimes[0]` as `gridStartMs`, so a correct BPM
 * with the wrong phase still mis-places every beat-relative decision the chart
 * generator makes (subdivision counts, chord caps, sustain eligibility).
 *
 * Method: autocorrelation of the mean-removed envelope, scored through a comb
 * filter (so the tactus wins over its subdivisions) and a log-normal tempo prior
 * centred on 120 BPM (so the half- and double-tempo peaks that always
 * accompany it lose). Then a brute-force phase search at quarter-frame
 * resolution, which is ~3 ms — finer than the ±6 ms the frame grid can localize
 * anyway.
 */

export interface TempoEstimate {
  readonly bpm: number;
  /** Beat period in frames — fractional, straight from the score parabola. */
  readonly beatPeriodFrames: number;
  /** Offset of the first grid beat from frame 0, in frames. */
  readonly beatPhaseFrames: number;
  /** 0–1: how far the winning period stood above the field. Heuristic. */
  readonly confidence: number;
}

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
  /** Centre of the log-normal tempo prior, in BPM. */
  priorCentreBpm?: number;
  /** Width of that prior, in octaves. */
  priorOctaveSigma?: number;
  /** How many multiples of a candidate period the comb filter sums. */
  combHarmonics?: number;
  /** Returned when the envelope carries no usable periodicity. */
  fallbackBpm?: number;
  /** Window for the moving average that is subtracted, in ms. */
  detrendWindowMs?: number;
}

export function estimateTempo(
  flux: Float32Array,
  hopMs: number,
  opts: TempoOptions = {}
): TempoEstimate {
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;
  const priorCentreBpm = opts.priorCentreBpm ?? 120;
  const priorSigma = opts.priorOctaveSigma ?? 0.7;
  const harmonics = Math.max(1, opts.combHarmonics ?? 4);
  const fallbackBpm = opts.fallbackBpm ?? 120;
  const detrendWindowMs = opts.detrendWindowMs ?? 1000;

  const fallback = (): TempoEstimate => ({
    bpm: fallbackBpm,
    beatPeriodFrames: 60_000 / fallbackBpm / hopMs,
    beatPhaseFrames: 0,
    confidence: 0,
  });

  const n = flux.length;
  if (n < 8 || hopMs <= 0) return fallback();

  const d = detrend(flux, Math.max(3, Math.round(detrendWindowMs / hopMs)));
  let energy = 0;
  for (let i = 0; i < n; i++) energy += d[i]!;
  if (energy <= 0) return fallback();

  const lagMin = Math.max(2, Math.round(60_000 / maxBpm / hopMs));
  const lagMax = Math.min(
    Math.floor((n - 1) / 2),
    Math.round(60_000 / minBpm / hopMs)
  );
  if (lagMax <= lagMin) return fallback();

  // Autocorrelation up to the largest lag the comb filter will ask about.
  const acMax = Math.min(n - 1, lagMax * harmonics);
  const ac = new Float64Array(acMax + 1);
  for (let lag = 1; lag <= acMax; lag++) {
    const end = n - lag;
    // Too few overlapping samples to mean anything; leave it at 0 so the comb
    // filter simply stops finding support out there.
    if (end < 4) continue;
    let sum = 0;
    for (let i = 0; i < end; i++) sum += d[i]! * d[i + lag]!;
    ac[lag] = sum / end;
  }

  const scores = new Float64Array(lagMax + 1);
  let bestLag = lagMin;
  let bestScore = -Infinity;
  let scoreSum = 0;
  let scoreCount = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let comb = 0;
    for (let h = 1; h <= harmonics; h++) {
      const l = lag * h;
      if (l > acMax) break;
      comb += ac[l]! / h;
    }
    const bpm = 60_000 / (lag * hopMs);
    const score = comb * tempoPrior(bpm, priorCentreBpm, priorSigma);
    scores[lag] = score;
    scoreSum += score;
    scoreCount++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (!(bestScore > 0)) return fallback();

  const meanScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
  const confidence = clamp01((bestScore - meanScore) / bestScore);

  // Sub-frame period from a parabola through the score peak.
  let periodFrames = bestLag;
  if (bestLag > lagMin && bestLag < lagMax) {
    const a = scores[bestLag - 1]!;
    const b = scores[bestLag]!;
    const c = scores[bestLag + 1]!;
    const denom = a - 2 * b + c;
    if (denom < 0) {
      const shift = (0.5 * (a - c)) / denom;
      if (Number.isFinite(shift) && Math.abs(shift) <= 0.5) {
        periodFrames = bestLag + shift;
      }
    }
  }

  const beatPhaseFrames = bestPhase(d, periodFrames);

  return {
    bpm: 60_000 / (periodFrames * hopMs),
    beatPeriodFrames: periodFrames,
    beatPhaseFrames,
    confidence,
  };
}

/**
 * Nudges the beat grid onto the onsets actually detected.
 *
 * The envelope-based phase is within a frame or two, but the grid's first beat
 * becomes `gridStartMs`, and onsets are the thing the player hears. Takes the
 * strength-weighted median offset of every onset that already sits near a grid
 * line, so a few off-grid notes cannot drag the whole grid.
 *
 * Returns `beatPhaseMs` unchanged when too few onsets are close enough to say
 * anything.
 */
export function refineBeatPhaseMs(
  onsetTimesMs: readonly number[],
  strengths: readonly number[],
  beatPeriodMs: number,
  beatPhaseMs: number,
  toleranceFraction = 0.15
): number {
  if (beatPeriodMs <= 0 || onsetTimesMs.length < 4) return beatPhaseMs;
  const tolerance = beatPeriodMs * toleranceFraction;

  const offsets: Array<{ offset: number; weight: number }> = [];
  for (let i = 0; i < onsetTimesMs.length; i++) {
    const t = onsetTimesMs[i]!;
    const k = Math.round((t - beatPhaseMs) / beatPeriodMs);
    const offset = t - (beatPhaseMs + k * beatPeriodMs);
    if (Math.abs(offset) <= tolerance) {
      offsets.push({ offset, weight: Math.max(1e-6, strengths[i] ?? 1) });
    }
  }
  if (offsets.length < 4) return beatPhaseMs;

  offsets.sort((a, b) => a.offset - b.offset);
  let total = 0;
  for (const o of offsets) total += o.weight;
  let acc = 0;
  let median = offsets[0]!.offset;
  for (const o of offsets) {
    acc += o.weight;
    if (acc >= total / 2) {
      median = o.offset;
      break;
    }
  }

  // Keep the phase inside the first beat so `gridStartMs` stays near the start.
  let phase = beatPhaseMs + median;
  while (phase < 0) phase += beatPeriodMs;
  while (phase >= beatPeriodMs) phase -= beatPeriodMs;
  return phase;
}

// ---------------------------------------------------------------------------

/** Half-wave-rectified envelope with a moving average removed. */
function detrend(flux: Float32Array, windowFrames: number): Float32Array {
  const n = flux.length;
  const out = new Float32Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + flux[i]!;
  const half = Math.max(1, windowFrames >> 1);
  for (let i = 0; i < n; i++) {
    const lo = i - half < 0 ? 0 : i - half;
    const hi = i + half >= n ? n - 1 : i + half;
    const mean = (prefix[hi + 1]! - prefix[lo]!) / (hi - lo + 1);
    const v = flux[i]! - mean;
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

/** exp(-½ (log₂(bpm/centre)/σ)²) — symmetric in octaves, as tempo perception is. */
function tempoPrior(bpm: number, centreBpm: number, sigmaOctaves: number): number {
  const octaves = Math.log2(bpm / centreBpm);
  return Math.exp(-0.5 * (octaves / sigmaOctaves) ** 2);
}

/**
 * Phase whose grid collects the most envelope energy, searched at quarter-frame
 * resolution (~3 ms at hop 512 / 44.1 kHz).
 */
function bestPhase(d: Float32Array, periodFrames: number): number {
  const n = d.length;
  const step = 0.25;
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let phase = 0; phase < periodFrames; phase += step) {
    let sum = 0;
    for (let x = phase; x < n - 1; x += periodFrames) {
      const i = Math.floor(x);
      const frac = x - i;
      sum += d[i]! * (1 - frac) + d[i + 1]! * frac;
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
