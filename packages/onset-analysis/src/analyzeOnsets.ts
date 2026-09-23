/**
 * The package's entry point: mono samples in, `BeatEvent[]` out.
 *
 * Pure and `Float32Array`-in by design — that is what lets it run in a Worker,
 * in node tests, and (if it ever has to) on the main thread, with no Web Audio
 * anywhere near it.
 *
 * Three things here are easy to get wrong and expensive to debug, so they are
 * called out where they happen:
 *
 *  1. **`amplitude` / `rms` are absolute.** `applySilenceGate` in the chart
 *     generator compares them to fixed thresholds, so normalizing per track
 *     would hand every intro and outro a full chart.
 *  2. **A complete `isBeat` grid is emitted**, not just beats that happen to
 *     coincide with onsets. `buildRhythmContext` needs ≥ 4 `isBeat` events and
 *     takes `beatTimes[0]` as `gridStartMs`; with fewer it silently falls back
 *     to `gridStartMs = 0`, which is precisely the misalignment this replaces.
 *  3. **No phase bias.** `demoBeatEvents` shifts its synthetic grid forward by
 *     2000 ms to paper over having no idea where the music starts. Real onset
 *     times are used verbatim.
 */
import type { BeatEvent } from "@spotifyhero/shared-types";
import { percentileOf, pickPeaks, type PeakPickingOptions } from "./peakPicking.js";
import { PitchEstimator } from "./pitch.js";
import { computeOnsetEnvelope } from "./spectralFlux.js";
import { estimateTempo, refineBeatPhaseMs } from "./tempo.js";
import { frameAtTimeMs, frameTimeMs } from "./window.js";

/**
 * Bump when a change here would produce different `BeatEvent`s for the same
 * audio — retuned constants included. Callers that persist charts key on it, so
 * forgetting the bump means yesterday's chart is replayed by today's analyser.
 */
export const ONSET_ANALYSIS_VERSION = "onset-1";

/**
 * Structurally identical to the chart generator's `SongNormalizationProfile`.
 * Declared here rather than imported because this package sits below
 * `chart-generator` in the layering and depends only on `shared-types`.
 */
export type NormalizationProfile = "quiet" | "balanced" | "loud";

// ---------------------------------------------------------------------------
// Confidence mapping
//
// The single biggest tuning unknown in the feature. `DIFFICULTY_PARAMS` was
// tuned against `demoBeatEvents`, whose confidences are the three constants
// 0.94 / 0.71 / 0.34, so these numbers deliberately land in that range:
// grid-aligned peaks near 0.9 (Easy keeps them, sustains are eligible),
// off-grid peaks spread from ~0.34 up, which is just above
// `onsetConfidenceFloor` for easy/medium/hard (0.3).
//
// Expect to revisit these with the Phase 6 diagnostics panel.
// ---------------------------------------------------------------------------

/** Confidence of the weakest accepted peak. Above every `onsetConfidenceFloor`. */
const CONFIDENCE_FLOOR = 0.34;
/** Added to the floor at maximum salience. */
const CONFIDENCE_SPAN = 0.58;
/** < 1 lifts mid-salience peaks, so charts are not all-or-nothing. */
const CONFIDENCE_CURVE = 0.65;
/**
 * Floor for onsets that land on the beat grid. Above every difficulty's
 * `sustainConfidenceMin` (0.35–0.72), so sustains get assigned on real music,
 * and high enough that Easy's confidence-first density filter keeps the pulse.
 */
const GRID_ALIGNED_CONFIDENCE = 0.9;
/** How close to a grid line counts as "on the beat". */
const GRID_TOLERANCE_FRACTION = 0.12;
/** Absolute cap on that tolerance, so slow tempos do not swallow everything. */
const GRID_TOLERANCE_MAX_MS = 90;
/**
 * Grid beats with no detected onset. `isOnset: false`, so they never become
 * notes; they exist purely so `buildRhythmContext` sees a full pulse.
 */
const BEAT_ONLY_CONFIDENCE = 0.6;

/** Fraction of reported progress spent on the STFT sweep. */
const ENVELOPE_PROGRESS_SHARE = 0.85;

// ---------------------------------------------------------------------------
// Loudness profile
//
// Maps onto `NORMALIZATION_SILENCE_MULTIPLIER` in the chart generator: "quiet"
// scales the silence gate down by 0.82 so a quiet master still gets charted,
// "loud" scales it up by 1.18. Thresholds are a first guess against the 90th
// percentile of frame RMS — a modern loud master sits near 0.3, a quiet
// acoustic recording near 0.05.
// ---------------------------------------------------------------------------

const QUIET_RMS_P90 = 0.08;
const LOUD_RMS_P90 = 0.24;

export interface OnsetAnalysisOptions {
  /** 2048 → 46 ms window. */
  fftSize?: number;
  /** 512 → 11.6 ms hop at 44.1 kHz, ~±6 ms onset localization. */
  hopSize?: number;
  /** 0..1, called every `progressEveryFrames` frames of the STFT sweep. */
  onProgress?: (progress: number) => void;
  progressEveryFrames?: number;
  /** One extra FFT per onset. On by default. */
  estimatePitch?: boolean;
  minBpm?: number;
  maxBpm?: number;
  peakPicking?: PeakPickingOptions;
}

/** Everything the Phase 6 diagnostics panel needs to tune the above constants. */
export interface OnsetAnalysisStats {
  frameCount: number;
  hopMs: number;
  onsetCount: number;
  gridAlignedOnsetCount: number;
  beatEventCount: number;
  pitchedOnsetCount: number;
  tempoConfidence: number;
  fluxMedian: number;
  fluxP95: number;
  rmsP90: number;
  amplitudeP90: number;
}

export interface OnsetAnalysisResult {
  events: BeatEvent[];
  bpm: number;
  /** Time of the first grid beat, in ms. Feeds `Chart` alignment via `isBeat`. */
  beatPhaseMs: number;
  normalizationProfile: NormalizationProfile;
  durationMs: number;
  stats: OnsetAnalysisStats;
}

export function analyzeOnsets(
  mono: Float32Array,
  sampleRate: number,
  opts: OnsetAnalysisOptions = {}
): OnsetAnalysisResult {
  const durationMs = (mono.length / sampleRate) * 1000;

  // -- Pass 1: flux + absolute level per frame -------------------------------
  const env = computeOnsetEnvelope(mono, sampleRate, {
    ...(opts.fftSize !== undefined ? { fftSize: opts.fftSize } : {}),
    ...(opts.hopSize !== undefined ? { hopSize: opts.hopSize } : {}),
    ...(opts.progressEveryFrames !== undefined
      ? { progressEveryFrames: opts.progressEveryFrames }
      : {}),
    ...(opts.onProgress
      ? {
          onProgress: (p: number) => {
            opts.onProgress?.(p * ENVELOPE_PROGRESS_SHARE);
          },
        }
      : {}),
  });
  const geo = env.geo;

  // -- Peaks ------------------------------------------------------------------
  const { peaks, fluxP95, fluxMedian } = pickPeaks(env.flux, opts.peakPicking ?? {});
  const fluxScale = Math.max(1e-9, fluxP95 - fluxMedian);

  const onsetTimesMs: number[] = [];
  const saliences: number[] = [];
  for (const peak of peaks) {
    onsetTimesMs.push(frameTimeMs(peak.frame + peak.frameShift, geo));
    saliences.push(clamp01((peak.strength - peak.localMedian) / fluxScale));
  }

  // -- Tempo + phase ----------------------------------------------------------
  const tempo = estimateTempo(env.flux, geo.hopMs, {
    ...(opts.minBpm !== undefined ? { minBpm: opts.minBpm } : {}),
    ...(opts.maxBpm !== undefined ? { maxBpm: opts.maxBpm } : {}),
  });
  const beatPeriodMs = 60_000 / tempo.bpm;
  const beatPhaseMs = refineBeatPhaseMs(
    onsetTimesMs,
    saliences,
    beatPeriodMs,
    frameTimeMs(tempo.beatPhaseFrames, geo)
  );

  // -- Pass 2: pitch at the onsets only --------------------------------------
  const wantPitch = opts.estimatePitch !== false;
  const pitchHz: Array<number | null> = new Array(peaks.length).fill(null);
  let pitchedOnsetCount = 0;
  if (wantPitch && peaks.length > 0) {
    const estimator = new PitchEstimator(geo.fftSize, sampleRate);
    for (let i = 0; i < peaks.length; i++) {
      const centreSample = (onsetTimesMs[i]! / 1000) * sampleRate;
      const hz = estimator.estimateHz(mono, centreSample);
      pitchHz[i] = hz;
      if (hz !== null) pitchedOnsetCount++;
      if (opts.onProgress && (i % 64 === 0 || i === peaks.length - 1)) {
        opts.onProgress(
          ENVELOPE_PROGRESS_SHARE +
            (1 - ENVELOPE_PROGRESS_SHARE) * ((i + 1) / peaks.length)
        );
      }
    }
  } else {
    opts.onProgress?.(1);
  }

  // -- Events ----------------------------------------------------------------
  const gridTolerance = Math.min(
    GRID_TOLERANCE_MAX_MS,
    beatPeriodMs * GRID_TOLERANCE_FRACTION
  );
  const byTime = new Map<number, BeatEvent>();
  /** Grid indices already represented by a real onset — no synthetic twin. */
  const claimedBeats = new Set<number>();
  let gridAlignedOnsetCount = 0;

  const levelAt = (timeMs: number): { amplitude: number; rms: number } => {
    const frame = clamp(frameAtTimeMs(timeMs, geo), 0, env.frameCount - 1);
    return { amplitude: env.amplitude[frame]!, rms: env.rms[frame]! };
  };

  for (let i = 0; i < peaks.length; i++) {
    const timeMs = Math.max(0, onsetTimesMs[i]!);
    const salience = saliences[i]!;

    const beatIndex = Math.round((timeMs - beatPhaseMs) / beatPeriodMs);
    const gridTimeMs = beatPhaseMs + beatIndex * beatPeriodMs;
    const onGrid =
      beatIndex >= 0 && Math.abs(timeMs - gridTimeMs) <= gridTolerance;
    if (onGrid) {
      claimedBeats.add(beatIndex);
      gridAlignedOnsetCount++;
    }

    const base = CONFIDENCE_FLOOR + CONFIDENCE_SPAN * salience ** CONFIDENCE_CURVE;
    const confidence = clamp(
      onGrid ? Math.max(base, GRID_ALIGNED_CONFIDENCE) : base,
      0.01,
      0.99
    );
    const level = levelAt(timeMs);
    const hz = pitchHz[i];

    put(byTime, {
      timeMs,
      confidence,
      amplitude: level.amplitude,
      rms: level.rms,
      spectralFlux: clamp01(salience),
      isBeat: onGrid,
      isOnset: true,
      ...(hz !== null && hz !== undefined && Number.isFinite(hz)
        ? { pitchHz: hz }
        : {}),
    });
  }

  // The rest of the pulse, so `buildRhythmContext` gets a complete grid even
  // through a breakdown where nothing is detected.
  const lastBeatIndex = Math.floor((durationMs - beatPhaseMs) / beatPeriodMs);
  let beatEventCount = claimedBeats.size;
  for (let k = 0; k <= lastBeatIndex; k++) {
    if (claimedBeats.has(k)) continue;
    const timeMs = beatPhaseMs + k * beatPeriodMs;
    if (timeMs < 0 || timeMs >= durationMs) continue;
    const level = levelAt(timeMs);
    put(byTime, {
      timeMs,
      confidence: BEAT_ONLY_CONFIDENCE,
      amplitude: level.amplitude,
      rms: level.rms,
      isBeat: true,
      isOnset: false,
    });
    beatEventCount++;
  }

  const events = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);

  const rmsP90 = percentileOf(env.rms, 0.9);
  const amplitudeP90 = percentileOf(env.amplitude, 0.9);

  return {
    events,
    bpm: tempo.bpm,
    beatPhaseMs,
    normalizationProfile: profileForRms(rmsP90),
    durationMs,
    stats: {
      frameCount: env.frameCount,
      hopMs: geo.hopMs,
      onsetCount: peaks.length,
      gridAlignedOnsetCount,
      beatEventCount,
      pitchedOnsetCount,
      tempoConfidence: tempo.confidence,
      fluxMedian,
      fluxP95,
      rmsP90,
      amplitudeP90,
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Insert keyed by whole ms, keeping the higher confidence and OR-ing the roles —
 * same collision rule as `demoBeatEvents`, so a grid beat landing on the same
 * millisecond as an onset yields one event that is both.
 */
function put(byTime: Map<number, BeatEvent>, event: BeatEvent): void {
  const key = Math.round(event.timeMs);
  const prev = byTime.get(key);
  if (!prev) {
    byTime.set(key, { ...event, timeMs: key });
    return;
  }
  byTime.set(key, {
    ...(event.confidence >= prev.confidence ? event : prev),
    timeMs: key,
    isBeat: prev.isBeat || event.isBeat,
    isOnset: prev.isOnset || event.isOnset,
  });
}

function profileForRms(rmsP90: number): NormalizationProfile {
  if (rmsP90 < QUIET_RMS_P90) return "quiet";
  if (rmsP90 > LOUD_RMS_P90) return "loud";
  return "balanced";
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
