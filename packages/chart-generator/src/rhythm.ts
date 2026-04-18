import type { BeatEvent, Difficulty } from "@spotifyhero/shared-types";
import { computeMelodicAggressionPerBeat, buildOnsetExcitementByTime } from "./melodicFeatures.js";

/** Merged quarter-note pulse + per-beat onset counts (for subdivision & chords). */
export interface RhythmContext {
  beatPeriodMs: number;
  gridStartMs: number;
  /** `onsetsPerBeat[i]` = onsets in [gridStart + i*P, gridStart + (i+1)*P) */
  onsetsPerBeat: number[];
  /**
   * 0–1 per beat: pitch motion, tight inter-onset intervals, spectral flux, RMS jumps.
   * Boosts note retention in fast melodic runs.
   */
  melodicAggression: number[];
  /** BPM implied by median beat spacing — use for hold windows when it differs from track metadata. */
  effectiveBpm: number;
  /** Best-effort 3/4 vs 4/4 from onset density patterns (simple meters). */
  beatsPerMeasure: 3 | 4;
}

function mergeCloseBeatTimes(times: readonly number[], mergeMs: number): number[] {
  if (times.length === 0) return [];
  const s = [...times].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of s) {
    const last = out[out.length - 1];
    if (last !== undefined && t - last <= mergeMs) {
      out[out.length - 1] = (last + t) / 2;
    } else {
      out.push(t);
    }
  }
  return out;
}

function medianSorted(values: number[]): number {
  if (values.length === 0) return 500;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

/**
 * Infer bar length (3 vs 4 beats) by which grouping yields more stable “bar energy”
 * (sum of onsets per bar). Wrong grouping tends to inflate variance.
 */
export function inferBeatsPerMeasure(onsetsPerBeat: readonly number[]): 3 | 4 {
  if (onsetsPerBeat.length < 24) return 4;
  const barSums = (width: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i + width <= onsetsPerBeat.length; i += width) {
      let s = 0;
      for (let j = 0; j < width; j++) s += onsetsPerBeat[i + j]!;
      out.push(s);
    }
    return out;
  };
  const cov = (xs: readonly number[]): number => {
    if (xs.length < 3) return 1;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / xs.length;
    return Math.sqrt(v) / Math.max(1e-6, m);
  };
  const c3 = cov(barSums(3));
  const c4 = cov(barSums(4));
  return c3 * 1.02 < c4 ? 3 : 4;
}

/**
 * Build a fixed beat grid from detected downbeats (or BPM fallback) and count how many
 * onsets land in each beat — drives 2–5+ “stream density” and chord caps.
 */
export function buildRhythmContext(
  beatEvents: readonly BeatEvent[],
  silenceGatedOnsets: readonly BeatEvent[],
  fallbackBpm: number
): RhythmContext {
  const beatTimes = mergeCloseBeatTimes(
    beatEvents.filter((b) => b.isBeat).map((b) => b.timeMs),
    45
  );
  let beatPeriodMs: number;
  let gridStartMs: number;

  if (beatTimes.length >= 4) {
    const gaps: number[] = [];
    for (let i = 1; i < beatTimes.length; i++) {
      gaps.push(beatTimes[i]! - beatTimes[i - 1]!);
    }
    gaps.sort((a, b) => a - b);
    beatPeriodMs = Math.max(120, Math.round(medianSorted(gaps)));
    gridStartMs = beatTimes[0]!;
  } else {
    beatPeriodMs = Math.round(60_000 / Math.max(48, fallbackBpm));
    gridStartMs = 0;
  }

  let lastT = gridStartMs;
  for (const o of silenceGatedOnsets) {
    if (o.isOnset) lastT = Math.max(lastT, o.timeMs);
  }
  for (const b of beatTimes) {
    lastT = Math.max(lastT, b);
  }

  const nBeats = Math.max(
    1,
    Math.min(32_768, Math.ceil((lastT - gridStartMs) / beatPeriodMs) + 3)
  );
  const onsetsPerBeat = new Array<number>(nBeats).fill(0);
  for (const o of silenceGatedOnsets) {
    if (!o.isOnset) continue;
    let k = Math.floor((o.timeMs - gridStartMs) / beatPeriodMs);
    if (k < 0) k = 0;
    if (k >= nBeats) k = nBeats - 1;
    const slot = onsetsPerBeat[k];
    onsetsPerBeat[k] = (slot ?? 0) + 1;
  }

  const beatsPerMeasure = inferBeatsPerMeasure(onsetsPerBeat);
  const melodicAggression = computeMelodicAggressionPerBeat(
    silenceGatedOnsets,
    gridStartMs,
    beatPeriodMs,
    nBeats
  );
  return {
    beatPeriodMs,
    gridStartMs,
    onsetsPerBeat,
    melodicAggression,
    effectiveBpm: 60_000 / beatPeriodMs,
    beatsPerMeasure,
  };
}

export function beatIndexForTime(
  timeMs: number,
  ctx: Pick<RhythmContext, "gridStartMs" | "beatPeriodMs" | "onsetsPerBeat">
): number {
  const { gridStartMs, beatPeriodMs, onsetsPerBeat } = ctx;
  if (beatPeriodMs <= 0) return 0;
  let k = Math.floor((timeMs - gridStartMs) / beatPeriodMs);
  if (k < 0) k = 0;
  if (k >= onsetsPerBeat.length) k = onsetsPerBeat.length - 1;
  return k;
}

/** How many simultaneous lanes to allow at this time — from local onset crowding (capped at 4 lanes). */
export function chordCapForTime(timeMs: number, ctx: RhythmContext): number {
  const k = beatIndexForTime(timeMs, ctx);
  const n = ctx.onsetsPerBeat[k] ?? 1;
  const mel = ctx.melodicAggression[k] ?? 0;
  const bump = mel >= 0.58 ? 1 : 0;
  return Math.max(1, Math.min(4, Math.min(5, n + bump)));
}

function mix32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return x ^ (x >>> 16);
}

/**
 * Like legacy `chordSizeForEvent`, but `maxChord` follows the song’s measured onsets/beat
 * (2–5 stream → up to 4-lane chords when the audio is dense).
 */
export function chordSizeForRhythm(
  difficulty: Difficulty,
  trackId: string,
  timeMs: number,
  confidence: number,
  maxChord: number
): 1 | 2 | 3 | 4 {
  const cap = Math.max(1, Math.min(4, Math.floor(maxChord))) as 1 | 2 | 3 | 4;
  const chordMinConf = difficulty === "expert" ? 0.32 : 0.45;
  if (confidence < chordMinConf) return 1;
  let h = 2166136261;
  for (let i = 0; i < trackId.length; i++) {
    h = Math.imul(h ^ trackId.charCodeAt(i), 16777619);
  }
  h = Math.imul(h ^ Math.floor(timeMs), 2246822519);
  const roll = (mix32(h) >>> 0) / 4294967296;

  let desired: 1 | 2 | 3 | 4 = 1;
  if (difficulty === "easy") {
    desired = roll < 0.035 ? 2 : 1;
  } else if (difficulty === "medium") {
    if (roll < 0.02) desired = 3;
    else if (roll < 0.095) desired = 2;
    else desired = 1;
  } else if (difficulty === "hard") {
    if (roll < 0.015) desired = 4;
    else if (roll < 0.07) desired = 3;
    else if (roll < 0.2) desired = 2;
    else desired = 1;
  } else {
    if (roll < 0.16) desired = 4;
    else if (roll < 0.44) desired = 3;
    else if (roll < 0.74) desired = 2;
    else desired = 1;
  }
  return (Math.min(desired, cap) || 1) as 1 | 2 | 3 | 4;
}

type BeatBucket = { beatIdx: number; events: BeatEvent[] };

function groupOnsetsByBeat(
  onsets: readonly BeatEvent[],
  ctx: RhythmContext
): BeatBucket[] {
  const map = new Map<number, BeatEvent[]>();
  for (const e of onsets) {
    const bi = beatIndexForTime(e.timeMs, ctx);
    const arr = map.get(bi) ?? [];
    arr.push(e);
    map.set(bi, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([beatIdx, events]) => ({
      beatIdx,
      events: [...events].sort((a, b) => a.timeMs - b.timeMs),
    }));
}

function sampleBucketUniform(events: readonly BeatEvent[], target: number): BeatEvent[] {
  if (target <= 0) return [];
  if (target >= events.length) return [...events];
  const sortedByTime = [...events].sort((a, b) => a.timeMs - b.timeMs);
  const step = sortedByTime.length / Math.max(target, 1);
  const filtered: BeatEvent[] = [];
  let cursor = 0;
  while (filtered.length < target && Math.floor(cursor) < sortedByTime.length) {
    const idx = Math.floor(cursor);
    const event = sortedByTime[idx];
    if (event) filtered.push(event);
    cursor += step;
  }
  return filtered;
}

function sampleBucketConfidence(
  events: readonly BeatEvent[],
  target: number,
  excitement: Map<number, number>
): BeatEvent[] {
  if (target <= 0) return [];
  if (target >= events.length) return [...events];
  return [...events]
    .sort((a, b) => {
      const ea = 1 + 0.72 * (excitement.get(a.timeMs) ?? 0);
      const eb = 1 + 0.72 * (excitement.get(b.timeMs) ?? 0);
      const sa = a.confidence * ea;
      const sb = b.confidence * eb;
      return sb - sa || a.timeMs - b.timeMs;
    })
    .slice(0, target);
}

/**
 * Per-beat proportional sampling: dense beats (many onsets in one quarter) keep more notes
 * after the global difficulty multiplier, instead of thinning everything uniformly.
 */
export function densityFilterPerBeat(
  onsets: BeatEvent[],
  ctx: RhythmContext,
  densityMultiplier: number,
  uniformConfidence: boolean
): BeatEvent[] {
  if (onsets.length === 0) return [];
  const globalCap = Math.max(0, Math.ceil(onsets.length * densityMultiplier));
  if (globalCap === 0) return [];

  const buckets = groupOnsetsByBeat(onsets, ctx);
  if (buckets.length === 0) return [];

  const excitement = buildOnsetExcitementByTime(onsets);

  let targets = buckets.map(({ beatIdx, events }) => {
    const refDensity = Math.max(1, ctx.onsetsPerBeat[beatIdx] ?? 1);
    const mel = ctx.melodicAggression[beatIdx] ?? 0;
    const boost =
      (1 + 0.22 * Math.min(4, Math.max(0, refDensity - 1))) * (1 + 0.2 * mel);
    return Math.max(0, Math.ceil(events.length * densityMultiplier * boost));
  });
  let sumT = targets.reduce((a, b) => a + b, 0);
  if (sumT > globalCap && sumT > 0) {
    const scale = globalCap / sumT;
    targets = targets.map((t) => Math.max(0, Math.floor(t * scale)));
  }
  let sum = targets.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum < globalCap && guard++ < globalCap + 64) {
    let progressed = false;
    for (let i = 0; i < buckets.length; i++) {
      if (sum >= globalCap) break;
      if (targets[i]! < buckets[i]!.events.length) {
        targets[i]! += 1;
        sum += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  guard = 0;
  while (sum > globalCap && guard++ < globalCap + 64) {
    let progressed = false;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (sum <= globalCap) break;
      if (targets[i]! > 0) {
        targets[i]! -= 1;
        sum -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const out: BeatEvent[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const { events } = buckets[i]!;
    const target = Math.min(targets[i] ?? 0, events.length);
    if (target <= 0) continue;
    const part = uniformConfidence
      ? sampleBucketUniform(events, target)
      : sampleBucketConfidence(events, target, excitement);
    out.push(...part);
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  if (out.length <= globalCap) return out;
  return out.slice(0, globalCap);
}
