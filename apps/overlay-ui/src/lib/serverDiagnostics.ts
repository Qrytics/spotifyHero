/**
 * Music-server pipeline diagnostics — the confidence-tuning surface.
 *
 * `DIFFICULTY_PARAMS` was tuned against `demoBeatEvents`' synthetic grid, whose
 * confidences are three fixed values (0.94 / 0.71 / 0.34). Real spectral flux is
 * a continuous distribution with a different shape, so the thresholds it is
 * compared against (`onsetConfidenceFloor`, `sustainConfidenceMin`) can silently
 * produce an empty Easy chart or a chart with no sustains. Numbers, not
 * listening, are what fix that — hence this panel.
 *
 * Same shape as `spotifyDiagnostics.ts`, and it shares that module's debug flag
 * and toggle event: one `Ctrl+Shift+D`, one `spotifyHero_debug` key, and `App`
 * renders whichever panel matches the active music source.
 */
import type { BeatEvent, Chart, Difficulty, Note } from "@spotifyhero/shared-types";
import { DIFFICULTY_PARAMS } from "@spotifyhero/chart-generator";
import type {
  NormalizationProfile,
  OnsetAnalysisResult,
  OnsetAnalysisStats,
} from "@spotifyhero/onset-analysis";
// Subpath, not the package root — see the note in `chartCache.ts`.
import { ONSET_ANALYSIS_VERSION } from "@spotifyhero/onset-analysis/version";
import { activePlaybackClock } from "./playback/activeSource.js";
import { audioOutputLatencyMs } from "./audioContext.js";

export const SERVER_DIAGNOSTICS_EVENT = "spotifyhero-server-diagnostics";

/** Confidence buckets are 0.1 wide — coarse enough to read at 10px. */
const HISTOGRAM_BUCKETS = 10;

export type ConfidenceSummary = {
  /** Onset events only. Synthetic grid filler has a fixed confidence and would flatten the shape. */
  onsetCount: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
  /** Counts per 0.1-wide bucket, index 0 = [0,0.1). */
  histogram: number[];
  /** Survive `onsetConfidenceFloor` — i.e. are even candidates for this difficulty. */
  aboveOnsetFloor: number;
  /** Clear `sustainConfidenceMin` — the upper bound on how many sustains can exist. */
  aboveSustainMin: number;
};

export type ChartSummary = {
  generatorVersion: string;
  noteCount: number;
  notesPerMinute: number;
  sustainCount: number;
  sustainPercent: number;
  /** Notes per lane, index = lane. Lopsided means the stable-hash assignment is unhappy. */
  laneCounts: number[];
  minGapMs: number | null;
  medianGapMs: number | null;
  longestSustainMs: number;
};

/** Which pipeline entry point served this chart — see `useServerChartGeneration`. */
export type ServerChartServedFrom = "chart-cache" | "analysis-cache" | "analysis";

export type ServerChartDiagnostics = {
  updatedAt: string;
  trackId: string;
  trackName: string | null;
  difficulty: Difficulty;
  servedFrom: ServerChartServedFrom;
  /** Wall-clock cost of the two expensive steps; null when a cache served them. */
  timingsMs: { analyze: number | null; generate: number | null };
  analysis: {
    version: string;
    bpm: number;
    beatPhaseMs: number;
    durationMs: number;
    stats: OnsetAnalysisStats;
    normalizationProfile: NormalizationProfile;
    confidence: ConfidenceSummary;
  } | null;
  chart: ChartSummary;
  /** The thresholds the confidence distribution above is being judged against. */
  thresholds: {
    onsetConfidenceFloor: number;
    sustainConfidenceMin: number;
    densityMultiplier: number;
    minGapMs: number;
    minSustainPercent: number;
    maxSustainPercent: number;
  };
  clock: { isExact: boolean; outputLatencyMs: number };
};

/** Nearest-rank percentile of an already-sorted ascending array. */
function percentileOfSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1)
  );
  return sorted[idx]!;
}

export function summarizeConfidence(
  events: readonly BeatEvent[],
  difficulty: Difficulty
): ConfidenceSummary {
  const preset = DIFFICULTY_PARAMS[difficulty];
  const values: number[] = [];
  for (const e of events) {
    if (e.isOnset) values.push(e.confidence);
  }
  const histogram = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  let sum = 0;
  let aboveOnsetFloor = 0;
  let aboveSustainMin = 0;
  for (const v of values) {
    sum += v;
    const bucket = Math.min(
      HISTOGRAM_BUCKETS - 1,
      Math.max(0, Math.floor(v * HISTOGRAM_BUCKETS))
    );
    histogram[bucket] = histogram[bucket]! + 1;
    if (v > preset.onsetConfidenceFloor) aboveOnsetFloor++;
    if (v >= preset.sustainConfidenceMin) aboveSustainMin++;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    onsetCount: values.length,
    min: sorted[0] ?? 0,
    p25: percentileOfSorted(sorted, 0.25),
    median: percentileOfSorted(sorted, 0.5),
    p75: percentileOfSorted(sorted, 0.75),
    p90: percentileOfSorted(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? 0,
    mean: values.length === 0 ? 0 : sum / values.length,
    histogram,
    aboveOnsetFloor,
    aboveSustainMin,
  };
}

export function summarizeChart(chart: Chart, durationMs: number | null): ChartSummary {
  const notes: readonly Note[] = chart.notes;
  // 4 lanes, matching LANE_COUNTS in chart-generator and LANE_COUNT in note-highway
  // (both module-private, hence the repetition). This was a 5-slot array, so every
  // report carried a trailing 0 that looked like a starved lane.
  const laneCounts = [0, 0, 0, 0];
  const gaps: number[] = [];
  let sustainCount = 0;
  let longestSustainMs = 0;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!;
    if (note.lane >= 0 && note.lane < laneCounts.length) {
      laneCounts[note.lane] = laneCounts[note.lane]! + 1;
    }
    if (note.durationMs > 0) {
      sustainCount++;
      if (note.durationMs > longestSustainMs) longestSustainMs = note.durationMs;
    }
    const prev = notes[i - 1];
    if (prev) gaps.push(note.timeMs - prev.timeMs);
  }
  gaps.sort((a, b) => a - b);
  const minutes =
    durationMs !== null && durationMs > 0
      ? durationMs / 60_000
      : notes.length > 1
        ? (notes[notes.length - 1]!.timeMs - notes[0]!.timeMs) / 60_000
        : 0;
  return {
    generatorVersion: chart.generatorVersion,
    noteCount: notes.length,
    notesPerMinute: minutes > 0 ? notes.length / minutes : 0,
    sustainCount,
    sustainPercent: notes.length === 0 ? 0 : sustainCount / notes.length,
    laneCounts,
    minGapMs: gaps[0] ?? null,
    medianGapMs: gaps.length === 0 ? null : percentileOfSorted(gaps, 0.5),
    longestSustainMs,
  };
}

export function buildServerChartDiagnostics(input: {
  chart: Chart;
  trackName: string | null;
  servedFrom: ServerChartServedFrom;
  analysis: OnsetAnalysisResult | null;
  analyzeMs: number | null;
  generateMs: number | null;
}): ServerChartDiagnostics {
  const { chart, analysis } = input;
  const preset = DIFFICULTY_PARAMS[chart.difficulty];
  return {
    updatedAt: new Date().toISOString(),
    trackId: chart.trackId,
    trackName: input.trackName,
    difficulty: chart.difficulty,
    servedFrom: input.servedFrom,
    timingsMs: { analyze: input.analyzeMs, generate: input.generateMs },
    analysis: analysis
      ? {
          version: ONSET_ANALYSIS_VERSION,
          bpm: analysis.bpm,
          beatPhaseMs: analysis.beatPhaseMs,
          durationMs: analysis.durationMs,
          stats: analysis.stats,
          normalizationProfile: analysis.normalizationProfile,
          confidence: summarizeConfidence(analysis.events, chart.difficulty),
        }
      : null,
    chart: summarizeChart(chart, analysis?.durationMs ?? null),
    thresholds: {
      onsetConfidenceFloor: preset.onsetConfidenceFloor,
      sustainConfidenceMin: preset.sustainConfidenceMin,
      densityMultiplier: preset.densityMultiplier,
      minGapMs: preset.minGapMs,
      minSustainPercent: preset.minSustainPercent,
      maxSustainPercent: preset.maxSustainPercent,
    },
    clock: {
      isExact: activePlaybackClock().isExact,
      outputLatencyMs: audioOutputLatencyMs(),
    },
  };
}

type DiagnosticsWindow = Window & {
  __spotifyHeroServerDiagnostics?: ServerChartDiagnostics;
};

export function readServerDiagnostics(): ServerChartDiagnostics | null {
  if (typeof window === "undefined") return null;
  return (window as DiagnosticsWindow).__spotifyHeroServerDiagnostics ?? null;
}

export function publishServerDiagnostics(d: ServerChartDiagnostics): void {
  if (typeof window === "undefined") return;
  (window as DiagnosticsWindow).__spotifyHeroServerDiagnostics = d;
  window.dispatchEvent(
    new CustomEvent<ServerChartDiagnostics>(SERVER_DIAGNOSTICS_EVENT, { detail: d })
  );
}

export function serverDiagnosticsToClipboardText(d: ServerChartDiagnostics): string {
  return JSON.stringify(
    {
      app: "spotifyHero",
      mode: "music-server",
      ...d,
      hint: "Include this when reporting chart quality or timing issues.",
    },
    null,
    2
  );
}
