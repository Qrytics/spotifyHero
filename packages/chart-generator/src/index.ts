import type { BeatEvent, Chart, Difficulty, Note } from "@spotifyhero/shared-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChartGeneratorOptions {
  difficulty: Difficulty;
  /** Minimum ms gap between consecutive notes on the same lane. */
  minGapMs?: number;
  /** Song loudness normalization profile used to tune silence gating. */
  normalizationProfile?: SongNormalizationProfile;
  /**
   * Confidence gate: if ML model confidence is below this value for a note,
   * the deterministic placement is used instead.
   */
  mlConfidenceThreshold?: number;
}

export type SongNormalizationProfile = "quiet" | "balanced" | "loud";

export interface SilenceGateThresholds {
  /** Enter silence when both amplitude and RMS stay below these thresholds. */
  enterAmplitude: number;
  enterRms: number;
  /** Exit silence only after both amplitude and RMS cross these higher thresholds. */
  exitAmplitude: number;
  exitRms: number;
  /** Require this much contiguous low-energy time before confirming silence. */
  minSilenceMs: number;
}

const NORMALIZATION_SILENCE_MULTIPLIER: Record<SongNormalizationProfile, number> = {
  quiet: 0.82,
  balanced: 1,
  loud: 1.18,
};

// How many lanes per difficulty
const LANE_COUNTS: Record<Difficulty, number> = {
  easy: 4,
  medium: 4,
  hard: 4,
  expert: 4,
};

/**
 * Difficulty presets: fewer / wider-spaced notes on Easy; Expert is dense with tight gaps.
 * Hold windows scale so Easy gets longer sustains; Expert gets punchy bursts.
 */
export const DIFFICULTY_PARAMS: Record<
  Difficulty,
  {
    densityMultiplier: number;
    minGapMs: number;
    holdGapMinMs: number;
    holdGapMaxMs: number;
    /** Cap hold-eligible gap by beat interval fraction to avoid quarter-note over-merging. */
    holdGapBeatFraction: number;
    /** Holds shorter than this are emitted as taps (micro-holds are awkward). */
    minHoldDurationMs: number;
    /** Do not merge chains longer than this (more tapping, shorter sustains). */
    holdMaxDurationMs: number;
    /** Minimum sustain ratio target as a fraction of total notes. */
    minSustainPercent: number;
    /** Maximum sustain ratio target as a fraction of total notes. */
    maxSustainPercent: number;
    /** Minimum onset confidence required to classify note as sustain head. */
    sustainConfidenceMin: number;
    /** Hard cap for consecutive sustain heads (prevents long sustain-only chains). */
    maxConsecutiveSustains: number;
    /** Difficulty-tuned silence gate thresholds for onset eligibility. */
    silenceGate: SilenceGateThresholds;
  }
> = {
  easy: {
    densityMultiplier: 0.26,
    minGapMs: 148,
    holdGapMinMs: 540,
    holdGapMaxMs: 1180,
    holdGapBeatFraction: 0.7,
    minHoldDurationMs: 500,
    holdMaxDurationMs: 760,
    minSustainPercent: 0.06,
    maxSustainPercent: 0.14,
    sustainConfidenceMin: 0.72,
    maxConsecutiveSustains: 1,
    silenceGate: {
      enterAmplitude: 0.045,
      enterRms: 0.032,
      exitAmplitude: 0.072,
      exitRms: 0.052,
      minSilenceMs: 300,
    },
  },
  medium: {
    densityMultiplier: 0.52,
    minGapMs: 105,
    holdGapMinMs: 480,
    holdGapMaxMs: 1060,
    holdGapBeatFraction: 0.72,
    minHoldDurationMs: 460,
    holdMaxDurationMs: 720,
    minSustainPercent: 0.08,
    maxSustainPercent: 0.18,
    sustainConfidenceMin: 0.68,
    maxConsecutiveSustains: 2,
    silenceGate: {
      enterAmplitude: 0.04,
      enterRms: 0.028,
      exitAmplitude: 0.066,
      exitRms: 0.048,
      minSilenceMs: 250,
    },
  },
  hard: {
    densityMultiplier: 0.78,
    minGapMs: 88,
    holdGapMinMs: 440,
    holdGapMaxMs: 920,
    holdGapBeatFraction: 0.78,
    minHoldDurationMs: 430,
    holdMaxDurationMs: 640,
    minSustainPercent: 0.1,
    maxSustainPercent: 0.22,
    sustainConfidenceMin: 0.64,
    maxConsecutiveSustains: 2,
    silenceGate: {
      enterAmplitude: 0.036,
      enterRms: 0.025,
      exitAmplitude: 0.062,
      exitRms: 0.045,
      minSilenceMs: 220,
    },
  },
  expert: {
    densityMultiplier: 1.0,
    minGapMs: 58,
    holdGapMinMs: 360,
    holdGapMaxMs: 760,
    holdGapBeatFraction: 0.72,
    minHoldDurationMs: 320,
    holdMaxDurationMs: 520,
    minSustainPercent: 0.08,
    maxSustainPercent: 0.19,
    sustainConfidenceMin: 0.66,
    maxConsecutiveSustains: 2,
    silenceGate: {
      enterAmplitude: 0.03,
      enterRms: 0.02,
      exitAmplitude: 0.055,
      exitRms: 0.04,
      minSilenceMs: 180,
    },
  },
};

export interface FeatureExtractionStats {
  inputOnsets: number;
  confidenceMin: number;
  confidenceMax: number;
  confidenceAvg: number;
  gatedOnsets: number;
  droppedBySilenceGate: number;
  droppedByConfidenceGate: number;
  confirmedSilenceWindows: Array<{ startMs: number; endMs: number }>;
}

function withNormalization(value: number, profile: SongNormalizationProfile): number {
  return value * (NORMALIZATION_SILENCE_MULTIPLIER[profile] ?? 1);
}

function applySilenceGate(
  onsets: readonly BeatEvent[],
  gate: SilenceGateThresholds,
  normalizationProfile: SongNormalizationProfile
): { gated: BeatEvent[]; droppedBySilenceGate: number; confirmedSilenceWindows: Array<{ startMs: number; endMs: number }> } {
  if (onsets.length === 0) {
    return { gated: [], droppedBySilenceGate: 0, confirmedSilenceWindows: [] };
  }
  const enterAmplitude = withNormalization(gate.enterAmplitude, normalizationProfile);
  const enterRms = withNormalization(gate.enterRms, normalizationProfile);
  const exitAmplitude = withNormalization(gate.exitAmplitude, normalizationProfile);
  const exitRms = withNormalization(gate.exitRms, normalizationProfile);
  const sorted = [...onsets].sort((a, b) => a.timeMs - b.timeMs);
  const gated: BeatEvent[] = [];
  const silenceWindows: Array<{ startMs: number; endMs: number }> = [];
  let pendingSilenceStart: number | null = null;
  let confirmedSilenceStart: number | null = null;
  for (const event of sorted) {
    const amplitude = event.amplitude ?? 1;
    const rms = event.rms ?? amplitude;
    const belowEnter = amplitude <= enterAmplitude && rms <= enterRms;
    const aboveExit = amplitude >= exitAmplitude && rms >= exitRms;
    if (confirmedSilenceStart !== null) {
      if (aboveExit) {
        silenceWindows.push({ startMs: confirmedSilenceStart, endMs: event.timeMs });
        confirmedSilenceStart = null;
      } else {
        continue;
      }
    }
    if (pendingSilenceStart === null) {
      if (belowEnter) pendingSilenceStart = event.timeMs;
      gated.push(event);
      continue;
    }
    if (belowEnter) {
      if (event.timeMs - pendingSilenceStart >= gate.minSilenceMs) {
        confirmedSilenceStart = pendingSilenceStart;
      }
    } else {
      pendingSilenceStart = null;
    }
    if (confirmedSilenceStart === null) {
      gated.push(event);
    }
  }
  if (confirmedSilenceStart !== null) {
    silenceWindows.push({
      startMs: confirmedSilenceStart,
      endMs: sorted[sorted.length - 1]!.timeMs,
    });
  }
  return {
    gated,
    droppedBySilenceGate: Math.max(0, sorted.length - gated.length),
    confirmedSilenceWindows: silenceWindows,
  };
}

function summarizeFeatureExtraction(
  inputOnsets: readonly BeatEvent[],
  gatedOnsets: readonly BeatEvent[],
  droppedBySilenceGate: number,
  confidenceFloor: number,
  confirmedSilenceWindows: Array<{ startMs: number; endMs: number }>
): FeatureExtractionStats {
  let confidenceMin = 1;
  let confidenceMax = 0;
  let confidenceSum = 0;
  for (const event of inputOnsets) {
    confidenceMin = Math.min(confidenceMin, event.confidence);
    confidenceMax = Math.max(confidenceMax, event.confidence);
    confidenceSum += event.confidence;
  }
  const droppedByConfidenceGate = gatedOnsets.filter((e) => e.confidence <= confidenceFloor).length;
  return {
    inputOnsets: inputOnsets.length,
    confidenceMin: inputOnsets.length ? confidenceMin : 0,
    confidenceMax: inputOnsets.length ? confidenceMax : 0,
    confidenceAvg: inputOnsets.length ? confidenceSum / inputOnsets.length : 0,
    gatedOnsets: gatedOnsets.length,
    droppedBySilenceGate,
    droppedByConfidenceGate,
    confirmedSilenceWindows,
  };
}

interface SustainAssignmentCandidate {
  timeMs: number;
  lane: number;
  confidence: number;
}

function countTapSustain(notes: readonly Note[]): {
  taps: number;
  sustains: number;
  sustainPercent: number;
} {
  let taps = 0;
  let sustains = 0;
  for (const note of notes) {
    if (note.durationMs > 0) sustains += 1;
    else taps += 1;
  }
  const total = taps + sustains;
  return {
    taps,
    sustains,
    sustainPercent: total > 0 ? sustains / total : 0,
  };
}

function logChartStats(trackId: string, difficulty: Difficulty, notes: readonly Note[]): void {
  const stats = countTapSustain(notes);
  const sustainPct = (stats.sustainPercent * 100).toFixed(1);
  console.info(
    `[chart-generator] ${trackId}/${difficulty}: taps=${stats.taps}, sustains=${stats.sustains}, sustain%=${sustainPct}`
  );
}

function sustainGapMaxForBpm(
  bpm: number,
  holdGapMinMs: number,
  holdGapMaxMs: number,
  holdGapBeatFraction: number,
  minHoldDurationMs: number
): number {
  const beatScaled = Math.min(
    holdGapMaxMs,
    Math.round((60_000 / Math.max(1, bpm)) * holdGapBeatFraction)
  );
  return Math.max(holdGapMinMs, minHoldDurationMs, beatScaled);
}

function canAssignSustainAtIndex(
  notes: readonly Note[],
  index: number,
  sustainGapMinMs: number,
  sustainGapMaxMs: number,
  minHoldDurationMs: number,
  holdMaxDurationMs: number,
  sustainConfidenceMin: number
): { durationMs: number; confidence: number } | null {
  const head = notes[index];
  const next = notes[index + 1];
  if (!head || !next) return null;
  const gap = next.timeMs - head.timeMs;
  if (gap < sustainGapMinMs || gap > sustainGapMaxMs) return null;
  const confidence = Math.min(head.confidence, next.confidence);
  if (confidence < sustainConfidenceMin) return null;
  const durationMs = Math.min(gap, holdMaxDurationMs);
  if (durationMs < minHoldDurationMs) return null;
  return { durationMs, confidence };
}

function assignSustainsWithConstraints(
  candidates: readonly SustainAssignmentCandidate[],
  preset: (typeof DIFFICULTY_PARAMS)[Difficulty],
  bpm: number
): Note[] {
  const sustainGapMaxMs = sustainGapMaxForBpm(
    bpm,
    preset.holdGapMinMs,
    preset.holdGapMaxMs,
    preset.holdGapBeatFraction,
    preset.minHoldDurationMs
  );
  const notes: Note[] = candidates.map((n) => ({
    timeMs: n.timeMs,
    lane: n.lane,
    durationMs: 0,
  }));

  let consecutiveSustains = 0;
  for (let i = 0; i < candidates.length; i++) {
    const sustain = canAssignSustainAtIndex(
      candidates,
      i,
      preset.holdGapMinMs,
      sustainGapMaxMs,
      preset.minHoldDurationMs,
      preset.holdMaxDurationMs,
      preset.sustainConfidenceMin
    );
    if (
      !sustain ||
      consecutiveSustains >= preset.maxConsecutiveSustains
    ) {
      consecutiveSustains = 0;
      continue;
    }
    notes[i]!.durationMs = sustain.durationMs;
    consecutiveSustains += 1;
  }

  return notes;
}

function validateSustainRatios(
  notes: Note[],
  candidates: readonly SustainAssignmentCandidate[],
  preset: (typeof DIFFICULTY_PARAMS)[Difficulty],
  bpm: number
): Note[] {
  const sustainGapMaxMs = sustainGapMaxForBpm(
    bpm,
    preset.holdGapMinMs,
    preset.holdGapMaxMs,
    preset.holdGapBeatFraction,
    preset.minHoldDurationMs
  );
  const updated = notes.map((n) => ({ ...n }));
  const total = updated.length;
  if (total === 0) return updated;
  let minSustains = Math.ceil(total * preset.minSustainPercent);
  const maxSustains = Math.floor(total * preset.maxSustainPercent);
  const eligibleIndices = updated
    .map((_, idx) => idx)
    .filter((idx) =>
      Boolean(
        canAssignSustainAtIndex(
          candidates,
          idx,
          preset.holdGapMinMs,
          sustainGapMaxMs,
          preset.minHoldDurationMs,
          preset.holdMaxDurationMs,
          preset.sustainConfidenceMin
        )
      )
    );
  minSustains = Math.min(minSustains, eligibleIndices.length);

  const sustainIndices = updated
    .map((n, idx) => ({ n, idx }))
    .filter((x) => x.n.durationMs > 0)
    .map((x) => x.idx);

  if (sustainIndices.length > maxSustains) {
    const ranked = sustainIndices
      .map((idx) => {
        const sustain = canAssignSustainAtIndex(
          candidates,
          idx,
          preset.holdGapMinMs,
          sustainGapMaxMs,
          preset.minHoldDurationMs,
          preset.holdMaxDurationMs,
          preset.sustainConfidenceMin
        );
        return {
          idx,
          confidence: sustain?.confidence ?? 0,
          durationMs: updated[idx]!.durationMs,
        };
      })
      .sort(
        (a, b) =>
          a.confidence - b.confidence || a.durationMs - b.durationMs || b.idx - a.idx
      );
    let toDemote = sustainIndices.length - maxSustains;
    for (const item of ranked) {
      if (toDemote <= 0) break;
      updated[item.idx]!.durationMs = 0;
      toDemote -= 1;
    }
  }

  let sustainCount = updated.reduce(
    (sum, n) => sum + (n.durationMs > 0 ? 1 : 0),
    0
  );

  if (sustainCount < minSustains) {
    const promoteCandidates = updated
      .map((n, idx) => ({ n, idx }))
      .filter((x) => x.n.durationMs === 0)
      .map(({ idx }) => {
        const sustain = canAssignSustainAtIndex(
          candidates,
          idx,
          preset.holdGapMinMs,
          sustainGapMaxMs,
          preset.minHoldDurationMs,
          preset.holdMaxDurationMs,
          preset.sustainConfidenceMin
        );
        return { idx, sustain };
      })
      .filter((x): x is { idx: number; sustain: { durationMs: number; confidence: number } } => Boolean(x.sustain))
      .sort(
        (a, b) =>
          b.sustain.confidence - a.sustain.confidence ||
          b.sustain.durationMs - a.sustain.durationMs
      );
    for (const candidate of promoteCandidates) {
      if (sustainCount >= minSustains) break;
      updated[candidate.idx]!.durationMs = candidate.sustain.durationMs;
      sustainCount += 1;
    }
  }

  return updated;
}

/**
 * Merge consecutive taps **per lane** (sorted by time) into sustained notes.
 * Greedy chains: 3+ same-lane taps in range merge to one hold (head → tail).
 * If total duration &lt; `minHoldDurationMs`, the chain is emitted as separate taps.
 */
export function mergeAdjacentHoldNotes(
  notes: Note[],
  holdGapMinMs = 220,
  holdGapMaxMs = 1600,
  minHoldDurationMs = 280,
  holdMaxDurationMs = 1400,
  /** 0 = always merge eligible chains into holds (tests). Above 0 = deterministic tap chains. */
  holdDemergePercent = 0,
  trackId = "",
  maxHoldFraction = 1
): Note[] {
  const maxLane = notes.reduce((m, n) => Math.max(m, n.lane), 0);
  const buckets: Note[][] = Array.from({ length: maxLane + 1 }, () => []);

  for (const n of notes) {
    const lane = n.lane;
    if (lane >= 0 && lane <= buckets.length - 1) {
      buckets[lane]!.push(n);
    }
  }

  const merged: Note[] = [];
  for (let lane = 0; lane < buckets.length; lane++) {
    const laneNotes = buckets[lane]!.sort((a, b) => a.timeMs - b.timeMs);
    let i = 0;
    while (i < laneNotes.length) {
      const first = laneNotes[i]!;
      if (first.durationMs !== 0) {
        merged.push(first);
        i += 1;
        continue;
      }

      const headMs = laneNotes[i]!.timeMs;
      let j = i;
      while (j + 1 < laneNotes.length) {
        const a = laneNotes[j]!;
        const b = laneNotes[j + 1]!;
        if (a.durationMs !== 0 || b.durationMs !== 0) break;
        const gap = b.timeMs - a.timeMs;
        if (gap < holdGapMinMs || gap > holdGapMaxMs) break;
        if (b.timeMs - headMs > holdMaxDurationMs) break;
        j += 1;
      }

      if (j > i) {
        const head = laneNotes[i]!;
        const tail = laneNotes[j]!;
        const dur = tail.timeMs - head.timeMs;
        if (dur >= minHoldDurationMs) {
          const h = mix32(
            Math.imul(lane + 1, 0x85ebca6b) ^
              Math.floor(head.timeMs) ^
              Math.imul(Math.floor(tail.timeMs), 65537)
          );
          const demerge =
            holdDemergePercent > 0 &&
            (h >>> 0) % 100 < holdDemergePercent;
          let holdCoin = true;
          if (trackId && maxHoldFraction < 1) {
            let seed = 2166136261;
            for (let c = 0; c < trackId.length; c++) {
              seed = Math.imul(seed ^ trackId.charCodeAt(c), 16777619);
            }
            seed ^= Math.floor(head.timeMs) ^ Math.imul(lane + 1, 2246822519);
            const u = (mix32(seed) >>> 0) / 4294967296;
            holdCoin = u <= Math.max(0, Math.min(1, maxHoldFraction));
          }
          if (demerge || !holdCoin) {
            for (let k = i; k <= j; k++) {
              const n = laneNotes[k]!;
              merged.push({ timeMs: n.timeMs, lane, durationMs: 0 });
            }
          } else {
            merged.push({ timeMs: head.timeMs, lane, durationMs: dur });
          }
        } else {
          for (let k = i; k <= j; k++) {
            const n = laneNotes[k]!;
            merged.push({ timeMs: n.timeMs, lane, durationMs: 0 });
          }
        }
        i = j + 1;
      } else {
        merged.push({ timeMs: first.timeMs, lane, durationMs: 0 });
        i += 1;
      }
    }
  }

  merged.sort((a, b) => a.timeMs - b.timeMs);
  return merged;
}

function mix32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return x ^ (x >>> 16);
}

/** Deterministic lane choice — same inputs always yield same lane (per-song charts). */
function pickLaneDeterministic(
  trackId: string,
  timeMs: number,
  salt: number,
  valid: number[]
): number {
  if (valid.length === 0) return 0;
  if (valid.length === 1) return valid[0]!;
  let h = 2166136261;
  for (let i = 0; i < trackId.length; i++) {
    h = Math.imul(h ^ trackId.charCodeAt(i), 16777619);
  }
  h = Math.imul(h ^ timeMs, 1000003);
  h = Math.imul(h ^ salt, 2246822519);
  const idx = Math.abs(mix32(h)) % valid.length;
  return valid[idx]!;
}

// ---------------------------------------------------------------------------
// Step 1 – Deterministic signal-based chart generation
// ---------------------------------------------------------------------------

/**
 * Generates a rhythm chart from raw beat/onset events.
 *
 * Algorithm:
 *   1. Collect onsets from the beat stream.
 *   2. Apply density filter: highest-confidence onsets first, then cap count;
 *      re-sort by time (uniform confidence → same as proportional sampling).
 *   3. Among lanes that satisfy min-gap, pick a lane using a stable hash of
 *      track id + time + index (varied patterns per song, not a 0→1→2→3 loop).
 *   4. Merge holds per lane.
 */
export function generateDeterministicChart(
  trackId: string,
  beatEvents: BeatEvent[],
  bpm: number,
  options: ChartGeneratorOptions
): Chart {
  const { difficulty } = options;
  const preset = DIFFICULTY_PARAMS[difficulty];
  const minGapMs = options.minGapMs ?? preset.minGapMs;
  const normalizationProfile = options.normalizationProfile ?? "balanced";
  const laneCount = LANE_COUNTS[difficulty];
  const densityMultiplier = preset.densityMultiplier;
  const confidenceFloor = 0.3;
  const onsetCandidates = beatEvents.filter((e) => e.isOnset);
  const silenceGateResult = applySilenceGate(
    onsetCandidates,
    preset.silenceGate,
    normalizationProfile
  );
  const onsets = silenceGateResult.gated.filter((e) => e.confidence > confidenceFloor);
  const extractionStats = summarizeFeatureExtraction(
    onsetCandidates,
    silenceGateResult.gated,
    silenceGateResult.droppedBySilenceGate,
    confidenceFloor,
    silenceGateResult.confirmedSilenceWindows
  );
  console.debug(
    `[chart-generator] ${trackId}/${difficulty} feature stats`,
    extractionStats
  );

  // Density filter: confidence-first when strengths differ; uniform-confidence inputs keep legacy even spread in time
  const targetCount = Math.ceil(onsets.length * densityMultiplier);
  let minConf = Infinity;
  let maxConf = -Infinity;
  for (const e of onsets) {
    if (e.confidence < minConf) minConf = e.confidence;
    if (e.confidence > maxConf) maxConf = e.confidence;
  }
  const uniformConfidence =
    onsets.length === 0 || minConf === maxConf;

  let filtered: BeatEvent[];
  if (uniformConfidence) {
    const sortedByTime = [...onsets].sort((a, b) => a.timeMs - b.timeMs);
    const step = sortedByTime.length / Math.max(targetCount, 1);
    filtered = [];
    let cursor = 0;
    while (
      filtered.length < targetCount &&
      Math.floor(cursor) < sortedByTime.length
    ) {
      const idx = Math.floor(cursor);
      const event = sortedByTime[idx];
      if (event) filtered.push(event);
      cursor += step;
    }
  } else {
    const sortedByConfidence = [...onsets].sort((a, b) => {
      const d = b.confidence - a.confidence;
      return d !== 0 ? d : a.timeMs - b.timeMs;
    });
    filtered = sortedByConfidence
      .slice(0, Math.max(0, targetCount))
      .sort((a, b) => a.timeMs - b.timeMs);
  }

  const laneLastMs: number[] = new Array(laneCount).fill(-Infinity);
  const candidates: SustainAssignmentCandidate[] = [];
  let placementSalt = 0;

  for (const event of filtered) {
    const validLanes: number[] = [];
    for (let lane = 0; lane < laneCount; lane++) {
      const last = laneLastMs[lane] ?? -Infinity;
      if (event.timeMs - last >= minGapMs) {
        validLanes.push(lane);
      }
    }
    if (validLanes.length === 0) {
      continue;
    }
    const lane = pickLaneDeterministic(
      trackId,
      event.timeMs,
      placementSalt,
      validLanes
    );
    placementSalt += 1;
    candidates.push({ timeMs: event.timeMs, lane, confidence: event.confidence });
    laneLastMs[lane] = event.timeMs;
  }

  const initialNotes = assignSustainsWithConstraints(
    candidates,
    preset,
    bpm
  );
  const validatedNotes = validateSustainRatios(
    initialNotes,
    candidates,
    preset,
    bpm
  );
  logChartStats(trackId, difficulty, validatedNotes);

  return {
    trackId,
    difficulty,
    notes: validatedNotes,
    bpm,
    generatorVersion: "deterministic-1.6",
    generatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Step 2 – ML refinement stub
// ---------------------------------------------------------------------------

/**
 * Refinement context passed to ML model.
 * In production this is an ONNX model invoked via the Rust backend.
 */
export interface MLRefinementResult {
  /** Suggested notes from the model */
  notes: Note[];
  /** 0-1 overall confidence for this chart */
  confidence: number;
  /** Model identifier/version used */
  modelVersion: string;
}

/**
 * MLChartRefiner interface – implemented in the Rust/ONNX backend.
 * The TypeScript side calls this via Tauri IPC; this interface exists
 * for testing and mocking purposes.
 */
export interface MLChartRefiner {
  refine(
    baseNotes: Note[],
    trackId: string,
    difficulty: Difficulty
  ): Promise<MLRefinementResult>;
}

/**
 * Stub refiner that passes through the deterministic chart unchanged.
 * Replace with real ONNX-backed implementation via Tauri invoke.
 */
export class PassthroughMLRefiner implements MLChartRefiner {
  async refine(
    baseNotes: Note[],
    _trackId: string,
    _difficulty: Difficulty
  ): Promise<MLRefinementResult> {
    return {
      notes: baseNotes,
      confidence: 0, // always triggers fallback in production
      modelVersion: "passthrough-stub",
    };
  }
}

// ---------------------------------------------------------------------------
// Step 3 – Hybrid pipeline
// ---------------------------------------------------------------------------

/**
 * HybridChartGenerator orchestrates the full note generation pipeline:
 *   1. Deterministic baseline chart from beat events.
 *   2. ML refinement attempt.
 *   3. Confidence gate: use ML notes only if confidence ≥ threshold.
 *   4. Drift-correction hook (supplied by audio-engine).
 */
export class HybridChartGenerator {
  private refiner: MLChartRefiner;
  private confidenceThreshold: number;

  constructor(
    refiner: MLChartRefiner = new PassthroughMLRefiner(),
    confidenceThreshold = 0.65
  ) {
    this.refiner = refiner;
    this.confidenceThreshold = confidenceThreshold;
  }

  async generate(
    trackId: string,
    beatEvents: BeatEvent[],
    bpm: number,
    options: ChartGeneratorOptions
  ): Promise<Chart> {
    // Step 1: deterministic baseline
    const baseline = generateDeterministicChart(
      trackId,
      beatEvents,
      bpm,
      options
    );

    // Step 2: ML refinement
    let result: MLRefinementResult;
    try {
      result = await this.refiner.refine(
        baseline.notes,
        trackId,
        options.difficulty
      );
    } catch {
      // ML failure → fall back silently
      return baseline;
    }

    // Step 3: confidence gate
    if (result.confidence < this.confidenceThreshold) {
      return baseline;
    }

    return {
      ...baseline,
      notes: result.notes,
      generatorVersion: `hybrid-ml-${result.modelVersion}`,
    };
  }
}

// ---------------------------------------------------------------------------
// BPM estimation from beat events
// ---------------------------------------------------------------------------

/**
 * Estimates BPM from a sequence of beat events.
 * Uses the median inter-beat interval of high-confidence beats.
 */
export function estimateBpm(beatEvents: BeatEvent[]): number {
  const beats = beatEvents
    .filter((e) => e.isBeat && e.confidence > 0.5)
    .sort((a, b) => a.timeMs - b.timeMs);

  if (beats.length < 2) return 120; // sensible default

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const prev = beats[i - 1];
    const curr = beats[i];
    if (prev && curr) {
      intervals.push(curr.timeMs - prev.timeMs);
    }
  }

  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] ?? 500;
  return Math.round(60_000 / median);
}
