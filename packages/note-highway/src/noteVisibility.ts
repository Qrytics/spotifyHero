import type { Judgement, Note, ScoreEvent } from "@spotifyhero/shared-types";
import { CHART_LEAD_IN_MS, noteHeadTimeMs, noteTailTimeMs } from "@spotifyhero/gameplay-core";
import { LANE_COUNT, TIME_EPSILON_MS } from "./highwayConstants.js";

/**
 * Note visibility — which notes the highway must stop drawing, and which sustains
 * are mid-hold. **This is the fragile part of the renderer.** It has broken four
 * separate times (see `docs/sustain-visual-troubleshooting.md`), always by someone
 * tidying a conditional. It is canvas-free on purpose so `src/__tests__` can pin it.
 *
 * Both themes share this module; a bug here is not fixable by switching theme.
 */

/** Draw order is time-sorted; score events and visibility use chart `notes` indices — keep both. */
export type SortedNote = { note: Note; chartIndex: number };

export type SustainVisual = {
  id: number;
  startTime: number;
  endTime: number;
  headHidden: boolean;
  completed: boolean;
};

export type NoteVisibility = {
  /** Tap hidden immediately after a good-timing hit. */
  goneTap: Set<number>;
  /** Hold visuals tracked by absolute playback times (indexed by note id). */
  activeSustains: Map<number, SustainVisual>;
  /** Miss / bad: keep drawing until the gem slides past the bottom edge. */
  missSlide: Set<number>;
};

export function createNoteVisibility(): NoteVisibility {
  return {
    goneTap: new Set(),
    activeSustains: new Map(),
    missSlide: new Set(),
  };
}

export function clearNoteVisibility(vis: NoteVisibility): void {
  vis.goneTap.clear();
  vis.activeSustains.clear();
  vis.missSlide.clear();
}

/** Reused when chart has no notes — avoids allocating a new Set each frame. */
export const EMPTY_OCCLUDED: ReadonlySet<number> = new Set();

/** First index with sortedNotes[i].note.timeMs >= t (sorted by timeMs ascending). */
export function lowerBoundSortedTime(sortedNotes: readonly SortedNote[], t: number): number {
  let lo = 0;
  let hi = sortedNotes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedNotes[mid]!.note.timeMs < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sort chart notes by time while keeping their chart indices. Stable when already sorted. */
export function buildSortedNotes(raw: readonly Note[]): readonly SortedNote[] {
  if (raw.length === 0) return [];
  const withIdx = raw.map((note, chartIndex) => ({ note, chartIndex }));
  if (raw.length === 1) return withIdx;
  let sorted = true;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i]!.timeMs < raw[i - 1]!.timeMs) {
      sorted = false;
      break;
    }
  }
  return sorted ? withIdx : [...withIdx].sort((a, b) => a.note.timeMs - b.note.timeMs);
}

/**
 * Notes that should not draw a highway gem because another sustain on the lane already covers
 * that time: (1) head strictly inside another sustain's (head, tail), (2) tap whose head matches
 * another sustain's tail (next onset — avoids double tail cap + gem).
 */
export function occludedInsideSustain(
  sortedNotes: readonly SortedNote[],
  leadInMs: number
): Set<number> {
  const out = new Set<number>();
  const eps = TIME_EPSILON_MS;

  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const sustains: { chartIndex: number; head: number; tail: number }[] = [];
    for (let k = 0; k < sortedNotes.length; k++) {
      const { note, chartIndex } = sortedNotes[k]!;
      if (note.lane !== lane) continue;
      if (note.durationMs <= eps) continue;
      const h = noteHeadTimeMs(note, leadInMs);
      const t = noteTailTimeMs(note, leadInMs);
      if (t <= h + eps) continue;
      sustains.push({ chartIndex, head: h, tail: t });
    }
    sustains.sort((a, b) => a.head - b.head || a.tail - b.tail);

    for (let k = 0; k < sortedNotes.length; k++) {
      const { note, chartIndex } = sortedNotes[k]!;
      if (note.lane !== lane) continue;
      const h = noteHeadTimeMs(note, leadInMs);
      for (const s of sustains) {
        if (s.chartIndex === chartIndex) continue;
        if (h > s.head + eps && h < s.tail - eps) {
          out.add(chartIndex);
          break;
        }
        const tailSlop = Math.max(eps, 0.5);
        if (
          note.durationMs <= eps &&
          Math.abs(h - s.tail) <= tailSlop
        ) {
          out.add(chartIndex);
          break;
        }
      }
    }
  }

  return out;
}

/**
 * Whether this score event should spawn a hit burst, and with which judgement.
 * `null` = silent (sustain interior ticks, or explicitly suppressed fx).
 */
export function scoreEventBurstJudgement(ev: ScoreEvent, note: Note): Judgement | null {
  const allowHitBurst = isHoldSustainSuccessTick(ev, note)
    ? ev.showHitFx === true
    : ev.showHitFx !== false;
  return allowHitBurst ? ev.judgement : null;
}

/** Sustain interior/tail ticks omit accuracy; only the tail tick sets `showHitFx: true`. */
function isHoldSustainSuccessTick(ev: ScoreEvent, note: Note): boolean {
  return (
    note.durationMs > 0 &&
    ev.countsTowardAccuracy === false &&
    (ev.judgement === "perfect" || ev.judgement === "great" || ev.judgement === "good")
  );
}

/**
 * Fold one score event into visibility state.
 *
 * Moved here verbatim from the old `applyOneScoreEvent`. The early returns and
 * the order of the `goneTap` / `activeSustains` / `missSlide` mutations are load
 * bearing — do not restructure them.
 */
export function applyScoreEventToVisibility(
  ev: ScoreEvent,
  note: Note,
  vis: NoteVisibility
): void {
  const good =
    ev.judgement === "perfect" || ev.judgement === "great" || ev.judgement === "good";
  const failed = ev.judgement === "miss" || ev.judgement === "bad";
  const idx = ev.noteIndex;

  if (failed) {
    vis.goneTap.delete(idx);
    vis.activeSustains.delete(idx);
    vis.missSlide.add(idx);
    return;
  }
  if (!good) return;

  if (note.durationMs <= 0) {
    vis.goneTap.add(idx);
    vis.missSlide.delete(idx);
    return;
  }
  const startTime = noteHeadTimeMs(note, CHART_LEAD_IN_MS);
  const endTime = noteTailTimeMs(note, CHART_LEAD_IN_MS);
  const existing = vis.activeSustains.get(idx);
  vis.activeSustains.set(idx, {
    id: idx,
    startTime: existing?.startTime ?? startTime,
    endTime,
    headHidden: existing?.headHidden ?? false,
    completed: existing?.completed ?? false,
  });
  // Sustain ticks (interior + tail): each tick has a unique `sig` via `deltaMs`.
  if (isHoldSustainSuccessTick(ev, note)) {
    // Tail checkpoint marks completion; render removes strip exactly at note end.
    if (ev.showHitFx === true) {
      const current = vis.activeSustains.get(idx);
      if (current) {
        vis.activeSustains.set(idx, { ...current, completed: true });
      }
      vis.goneTap.add(idx);
    }
    vis.missSlide.delete(idx);
    return;
  }
  // Hold head
  vis.activeSustains.set(idx, {
    id: idx,
    startTime,
    endTime,
    headHidden: true,
    completed: false,
  });
  vis.missSlide.delete(idx);
}
