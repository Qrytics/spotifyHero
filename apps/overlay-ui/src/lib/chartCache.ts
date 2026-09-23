/**
 * Three caches, because the server path has three different costs to avoid.
 *
 *  1. **Analysis** (memory, 2 entries). Analysis is the expensive step — a
 *     download, a decode and ~1 s of FFT. Keeping `OnsetAnalysisResult` means a
 *     difficulty change re-runs only `generate()`, which is milliseconds. Two
 *     entries so switching back and forth between two songs still hits.
 *  2. **Chart** (memory, 8 entries). Cheap to hold, and makes difficulty
 *     toggling instant once a difficulty has been seen.
 *  3. **Chart** (`localStorage`, 10 entries). Survives a relaunch, so replaying
 *     yesterday's song starts immediately. Charts only: `BeatEvent[]` for a
 *     4-minute track is megabytes of JSON and would blow the quota by itself.
 *
 * Every persisted chart is re-parsed with `ChartSchema` on read, so a stored
 * entry from an older shape is discarded rather than trusted — the same
 * defensive posture as `loadCredentials()`.
 */
import { ChartSchema, type Chart, type Difficulty } from "@spotifyhero/shared-types";
// The only *value* the main bundle takes from this package is a version string,
// so it comes from the `./version` subpath: taking it from the package root
// would merge the whole DSP into this chunk, because the analyser is also
// dynamically imported (`analyzeAudioBuffer`'s main-thread fallback) and Rollup
// will not split a module that something imports statically. The type import
// below is erased, so it can address the root.
import { ONSET_ANALYSIS_VERSION } from "@spotifyhero/onset-analysis/version";
import type { OnsetAnalysisResult } from "@spotifyhero/onset-analysis";

const STORAGE_KEY = "spotifyHero_chartCache_v1";

/** Analysis results are ~1-3 MB each (mostly `BeatEvent[]`). */
const MAX_ANALYSIS_ENTRIES = 2;
const MAX_MEMORY_CHARTS = 8;
const MAX_PERSISTED_CHARTS = 10;

function chartKey(trackId: string, difficulty: Difficulty): string {
  return `${trackId}|${difficulty}`;
}

// ---------------------------------------------------------------------------
// Tier 1 — analysis, in memory
// ---------------------------------------------------------------------------

/** Insertion order is LRU order: re-inserting on read moves an entry to the end. */
const analysisCache = new Map<string, OnsetAnalysisResult>();

export function getCachedAnalysis(trackId: string): OnsetAnalysisResult | null {
  const hit = analysisCache.get(trackId);
  if (!hit) return null;
  analysisCache.delete(trackId);
  analysisCache.set(trackId, hit);
  return hit;
}

export function putCachedAnalysis(
  trackId: string,
  result: OnsetAnalysisResult
): void {
  analysisCache.delete(trackId);
  analysisCache.set(trackId, result);
  while (analysisCache.size > MAX_ANALYSIS_ENTRIES) {
    const oldest = analysisCache.keys().next().value;
    if (oldest === undefined) break;
    analysisCache.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// Tier 2 + 3 — charts
// ---------------------------------------------------------------------------

const memoryCharts = new Map<string, Chart>();

/**
 * Memory first, then `localStorage`; a persisted hit is promoted into memory so
 * the next lookup skips the parse.
 */
export function getCachedChart(
  trackId: string,
  difficulty: Difficulty
): Chart | null {
  const key = chartKey(trackId, difficulty);

  const inMemory = memoryCharts.get(key);
  if (inMemory) {
    memoryCharts.delete(key);
    memoryCharts.set(key, inMemory);
    return inMemory;
  }

  // The version check belongs here as well as in `putCachedChart`: a purge only
  // happens on the next write, and the interesting case is the first launch
  // after an upgrade, where nothing has been written yet.
  const persisted = readPersisted().find(
    (e) => e.key === key && e.analysisVersion === ONSET_ANALYSIS_VERSION
  );
  if (!persisted) return null;

  // `generatedAt` came back from JSON as a string; `z.coerce.date()` in
  // `ChartSchema` is what makes the round trip work.
  const parsed = ChartSchema.safeParse(persisted.chart);
  if (!parsed.success) {
    // Self-healing: an entry we can no longer read is an entry we drop.
    writePersisted(readPersisted().filter((e) => e.key !== key));
    return null;
  }

  putMemoryChart(key, parsed.data);
  return parsed.data;
}

export function putCachedChart(chart: Chart): void {
  const key = chartKey(chart.trackId, chart.difficulty);
  putMemoryChart(key, chart);

  // A generator *or* analyser change invalidates everything stored by the
  // previous pair, so drop mismatched entries instead of letting them age out
  // one by one. Both halves matter: retuning the onset constants changes the
  // chart without touching `generatorVersion`.
  const kept = readPersisted().filter(
    (e) =>
      e.key !== key &&
      e.generatorVersion === chart.generatorVersion &&
      e.analysisVersion === ONSET_ANALYSIS_VERSION
  );
  kept.push({
    key,
    generatorVersion: chart.generatorVersion,
    analysisVersion: ONSET_ANALYSIS_VERSION,
    storedAt: Date.now(),
    chart,
  });
  while (kept.length > MAX_PERSISTED_CHARTS) kept.shift();
  writePersisted(kept);
}

/** For tests and the diagnostics panel; does not touch `localStorage`. */
export function clearMemoryChartCache(): void {
  memoryCharts.clear();
  analysisCache.clear();
}

export function clearPersistedChartCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function putMemoryChart(key: string, chart: Chart): void {
  memoryCharts.delete(key);
  memoryCharts.set(key, chart);
  while (memoryCharts.size > MAX_MEMORY_CHARTS) {
    const oldest = memoryCharts.keys().next().value;
    if (oldest === undefined) break;
    memoryCharts.delete(oldest);
  }
}

// ---------------------------------------------------------------------------
// localStorage envelope
// ---------------------------------------------------------------------------

/**
 * Oldest first — `shift()` evicts, `push()` inserts. `chart` is deliberately
 * `unknown`: it is only trusted after `ChartSchema.safeParse`.
 */
type PersistedEntry = {
  key: string;
  generatorVersion: string;
  /** `ONSET_ANALYSIS_VERSION` at the time the chart was built. */
  analysisVersion: string;
  storedAt: number;
  chart: unknown;
};

function readPersisted(): PersistedEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPersistedEntry);
  } catch {
    return [];
  }
}

function isPersistedEntry(value: unknown): value is PersistedEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Partial<PersistedEntry>;
  return (
    typeof e.key === "string" &&
    typeof e.generatorVersion === "string" &&
    typeof e.analysisVersion === "string" &&
    typeof e.storedAt === "number" &&
    e.chart !== undefined
  );
}

function writePersisted(entries: PersistedEntry[]): void {
  let remaining = entries;
  // A long chart can be a few hundred KB; if the quota rejects the write, drop
  // the oldest entries and try again rather than losing the newest chart.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
      return;
    } catch {
      if (remaining.length <= 1) break;
      remaining = remaining.slice(Math.ceil(remaining.length / 2));
    }
  }
  // Out of room even for one chart — persistence is an optimisation, so give up
  // quietly and leave the memory tiers to do their job.
  clearPersistedChartCache();
}
