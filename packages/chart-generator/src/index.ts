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

// Max notes per beat interval per difficulty (density filter)
const DENSITY_MULTIPLIER: Record<Difficulty, number> = {
  easy: 0.3,
  medium: 0.6,
  hard: 0.85,
  expert: 1.0,
};

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
  const { difficulty, minGapMs = 80 } = options;
  const laneCount = LANE_COUNTS[difficulty];
  const densityMultiplier = DENSITY_MULTIPLIER[difficulty];

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

  for (const event of filtered) {
    // Rotate lane; skip if min-gap not met on current lane
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
    laneIdx = (laneIdx + 1) % laneCount;
  }

  return {
    trackId,
    difficulty,
    notes,
    bpm,
    generatorVersion: "deterministic-1.0",
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
