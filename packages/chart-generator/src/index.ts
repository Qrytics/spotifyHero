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
  }
> = {
  easy: {
    densityMultiplier: 0.26,
    minGapMs: 148,
    holdGapMinMs: 320,
    holdGapMaxMs: 2400,
  },
  medium: {
    densityMultiplier: 0.52,
    minGapMs: 105,
    holdGapMinMs: 260,
    holdGapMaxMs: 1900,
  },
  hard: {
    densityMultiplier: 0.78,
    minGapMs: 88,
    holdGapMinMs: 220,
    holdGapMaxMs: 1750,
  },
  expert: {
    densityMultiplier: 1.0,
    minGapMs: 72,
    holdGapMinMs: 200,
    holdGapMaxMs: 1550,
  },
};

/**
 * Merge consecutive taps **per lane** (sorted by time) into sustained notes.
 * Global-time adjacency almost never shares a lane because lanes rotate — this pass is required.
 */
export function mergeAdjacentHoldNotes(
  notes: Note[],
  holdGapMinMs = 220,
  holdGapMaxMs = 1600
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
      const a = laneNotes[i]!;
      const b = laneNotes[i + 1];
      if (
        b &&
        a.durationMs === 0 &&
        b.durationMs === 0
      ) {
        const gap = b.timeMs - a.timeMs;
        if (gap >= holdGapMinMs && gap <= holdGapMaxMs) {
          merged.push({ timeMs: a.timeMs, lane, durationMs: gap });
          i += 2;
          continue;
        }
      }
      merged.push(a);
      i += 1;
    }
  }

  merged.sort((a, b) => a.timeMs - b.timeMs);
  return merged;
}

// ---------------------------------------------------------------------------
// Step 1 – Deterministic signal-based chart generation
// ---------------------------------------------------------------------------

/**
 * Generates a rhythm chart from raw beat/onset events.
 *
 * Algorithm:
 *   1. Collect all onsets from the beat stream.
 *   2. Apply density filter based on difficulty.
 *   3. Assign each surviving onset to a lane using a round-robin +
 *      variation strategy to avoid monotone patterns.
 *   4. Enforce minimum gap per lane to prevent simultaneous overlap.
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

  // Collect onsets sorted by time
  const onsets = beatEvents
    .filter((e) => e.isOnset && e.confidence > 0.3)
    .sort((a, b) => a.timeMs - b.timeMs);

  // Density filter: keep a fraction of onsets
  const targetCount = Math.ceil(onsets.length * densityMultiplier);
  const step = onsets.length / Math.max(targetCount, 1);
  const filtered: BeatEvent[] = [];
  let cursor = 0;
  while (filtered.length < targetCount && Math.floor(cursor) < onsets.length) {
    const idx = Math.floor(cursor);
    const event = onsets[idx];
    if (event) filtered.push(event);
    cursor += step;
  }

  // Assign lanes
  const laneLastMs: number[] = new Array(laneCount).fill(-Infinity);
  const notes: Note[] = [];
  let laneIdx = 0;

  const difficultyStride =
    difficulty === "easy"
      ? 3
      : difficulty === "medium"
        ? 2
        : difficulty === "hard"
          ? 1
          : 1;

  for (const event of filtered) {
    let triesLeft = laneCount;
    while (triesLeft-- > 0) {
      const lane = laneIdx % laneCount;
      const last = laneLastMs[lane] ?? -Infinity;
      if (event.timeMs - last >= minGapMs) {
        notes.push({ timeMs: event.timeMs, lane, durationMs: 0 });
        laneLastMs[lane] = event.timeMs;
        break;
      }
      laneIdx += 1;
    }
    laneIdx = (laneIdx + difficultyStride) % laneCount;
  }

  const withHolds = mergeAdjacentHoldNotes(
    notes,
    preset.holdGapMinMs,
    preset.holdGapMaxMs
  );

  return {
    trackId,
    difficulty,
    notes: withHolds,
    bpm,
    generatorVersion: "deterministic-1.1",
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
