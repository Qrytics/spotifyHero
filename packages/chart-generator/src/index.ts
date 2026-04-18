import type { BeatEvent, Chart, Difficulty, Note } from "@spotifyhero/shared-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChartGeneratorOptions {
  difficulty: Difficulty;
  /** Minimum ms gap between consecutive notes on the same lane. */
  minGapMs?: number;
  /**
   * Confidence gate: if ML model confidence is below this value for a note,
   * the deterministic placement is used instead.
   */
  mlConfidenceThreshold?: number;
}

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
    /** Holds shorter than this are emitted as taps (micro-holds are awkward). */
    minHoldDurationMs: number;
    /** Do not merge chains longer than this (more tapping, shorter sustains). */
    holdMaxDurationMs: number;
    /**
     * 0–99: deterministic chance per mergeable chain to stay as separate taps
     * instead of one hold (more tap gameplay).
     */
    holdDemergePercent: number;
  }
> = {
  easy: {
    densityMultiplier: 0.26,
    minGapMs: 148,
    holdGapMinMs: 520,
    holdGapMaxMs: 1300,
    minHoldDurationMs: 400,
    holdMaxDurationMs: 720,
    holdDemergePercent: 48,
  },
  medium: {
    densityMultiplier: 0.52,
    minGapMs: 105,
    holdGapMinMs: 440,
    holdGapMaxMs: 1100,
    minHoldDurationMs: 320,
    holdMaxDurationMs: 720,
    holdDemergePercent: 42,
  },
  hard: {
    densityMultiplier: 0.78,
    minGapMs: 88,
    holdGapMinMs: 380,
    holdGapMaxMs: 900,
    minHoldDurationMs: 280,
    holdMaxDurationMs: 650,
    holdDemergePercent: 38,
  },
  expert: {
    densityMultiplier: 1.0,
    minGapMs: 72,
    holdGapMinMs: 340,
    holdGapMaxMs: 780,
    minHoldDurationMs: 240,
    holdMaxDurationMs: 580,
    holdDemergePercent: 34,
  },
};

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
  holdDemergePercent = 0
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
          if (demerge) {
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
  const laneCount = LANE_COUNTS[difficulty];
  const densityMultiplier = preset.densityMultiplier;

  const onsets = beatEvents.filter((e) => e.isOnset && e.confidence > 0.3);

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
  const notes: Note[] = [];
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
    notes.push({ timeMs: event.timeMs, lane, durationMs: 0 });
    laneLastMs[lane] = event.timeMs;
  }

  const withHolds = mergeAdjacentHoldNotes(
    notes,
    preset.holdGapMinMs,
    preset.holdGapMaxMs,
    preset.minHoldDurationMs,
    preset.holdMaxDurationMs,
    preset.holdDemergePercent
  );

  return {
    trackId,
    difficulty,
    notes: withHolds,
    bpm,
    generatorVersion: "deterministic-1.3",
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
