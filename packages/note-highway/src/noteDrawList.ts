import type { Note } from "@spotifyhero/shared-types";
import { CHART_LEAD_IN_MS, noteHeadTimeMs, noteTailTimeMs } from "@spotifyhero/gameplay-core";
import {
  LOOK_BACK_MS,
  OFF_SCREEN_BOTTOM_PAD,
  SCROLL_IN_EXTRA_MS,
  SUSTAIN_MIN_HEIGHT_PX,
  TIME_EPSILON_MS,
} from "./highwayConstants.js";
import {
  isSustainTailPastCanvasBottom,
  laneCenterX,
  yFromTime,
  type HighwayFrame,
} from "./highwayGeometry.js";
import {
  lowerBoundSortedTime,
  type NoteVisibility,
  type SortedNote,
} from "./noteVisibility.js";

/**
 * The note scan, separated from the painting.
 *
 * `paintNotes` used to do three jobs in one function: walk the visible window,
 * advance the sustain visibility state machine, and issue canvas calls. Only the
 * third is per-theme. Splitting the first two out means:
 *
 *  - both themes share **one** copy of the sustain logic, so a fix lands in both
 *    and the two can never diverge (the old code had the sustain block
 *    copy-pasted twice, verbatim, and they had to be kept in step by hand);
 *  - themes can iterate the result in several passes — one additive pass for all
 *    glow, one normal pass for all bodies — which is what makes the glow-heavy
 *    look *cheaper* than drawing each note's layers interleaved;
 *  - this file is canvas-free, so `src/__tests__` can pin the behaviour in plain
 *    node. That is the only automated defence the sustain logic has ever had.
 *
 * Every item is pooled and reused across frames. Nothing here allocates once the
 * pool has grown, which is why `length` is tracked separately from `items.length`.
 */

export const DRAW_GEM = 0;
export const DRAW_SUSTAIN = 1;
export const DRAW_SUSTAIN_HELD = 2;
export const DRAW_MISS_GEM = 3;
export const DRAW_MISS_SUSTAIN = 4;

export type DrawKind = 0 | 1 | 2 | 3 | 4;

export type DrawItem = {
  kind: DrawKind;
  chartIndex: number;
  lane: number;
  /** Lane centre. */
  cx: number;
  /** Gem centre Y. */
  cy: number;
  /** Outer head end of the sustain body (past the gem centre, so the cap overlaps the gem). */
  cyHeadBar: number;
  cyTail: number;
  /** Radius including the anticipation pop — gem size, and the sustain head offset. */
  radius: number;
  /**
   * Radius *without* the pop. Sustain width must come from this: the old code
   * used the popped radius, so every hold body visibly widened ~8% during the
   * ±100ms anticipation window.
   */
  baseRadius: number;
  /** 0..1 distance fade — 1 at the strike line. */
  approach: number;
  /** 0..1 proximity pulse within ±900ms of the head. */
  pulse: number;
  timeUntilMs: number;
  /** Hold progress 0..1; 0 for taps. */
  progress01: number;
};

export type DrawList = {
  items: DrawItem[];
  /** Number of valid entries in `items`. Entries past this are stale. */
  length: number;
  /** Reused per frame so the scan does not allocate a Set. */
  painted: Set<number>;
};

function makeItem(): DrawItem {
  return {
    kind: DRAW_GEM,
    chartIndex: -1,
    lane: 0,
    cx: 0,
    cy: 0,
    cyHeadBar: 0,
    cyTail: 0,
    radius: 0,
    baseRadius: 0,
    approach: 1,
    pulse: 0,
    timeUntilMs: 0,
    progress01: 0,
  };
}

export function createDrawList(): DrawList {
  return { items: [], length: 0, painted: new Set() };
}

/** Grows by doubling, outside the per-item hot path. Never shrinks. */
function nextItem(list: DrawList): DrawItem {
  if (list.length >= list.items.length) {
    const target = Math.max(64, list.items.length * 2);
    while (list.items.length < target) list.items.push(makeItem());
  }
  const item = list.items[list.length]!;
  list.length += 1;
  return item;
}

/**
 * Walk the visible window, advance `vis`, and fill `list`.
 *
 * Items are emitted in exactly the order the old `paintNotes` drew them, so a
 * theme that iterates once in order reproduces the original z-order.
 */
export function buildDrawList(
  list: DrawList,
  sortedNotes: readonly SortedNote[],
  chartNotes: readonly Note[],
  vis: NoteVisibility,
  occluded: ReadonlySet<number>,
  frame: HighwayFrame
): void {
  list.length = 0;
  list.painted.clear();

  const L = CHART_LEAD_IN_MS;
  const { hitLineY, pxPerMs, positionMs, h: height } = frame;

  scanVisibleWindow(list, sortedNotes, vis, occluded, frame, L);
  reapOffScreenSustains(chartNotes, vis, hitLineY, pxPerMs, positionMs, height);
  emitUnpaintedActiveSustains(list, chartNotes, vis, frame, L);
  emitMissSlidingNotes(list, chartNotes, vis, frame, L);
}

function scanVisibleWindow(
  list: DrawList,
  sortedNotes: readonly SortedNote[],
  vis: NoteVisibility,
  occluded: ReadonlySet<number>,
  frame: HighwayFrame,
  L: number
): void {
  const n = sortedNotes.length;
  if (n === 0) return;

  const { laneWidth, noteRadius, hitLineY, pxPerMs, positionMs, lookAheadMs, h: height } = frame;

  const tLow = positionMs - LOOK_BACK_MS;
  const tHigh = positionMs + lookAheadMs + SCROLL_IN_EXTRA_MS;
  let i = lowerBoundSortedTime(sortedNotes, tLow - L);
  while (i > 0) {
    const prevSn = sortedNotes[i - 1]!;
    const prev = prevSn.note;
    const prevEnd = noteTailTimeMs(prev, L);
    if (prevEnd >= tLow) {
      i -= 1;
      continue;
    }
    if (
      prev.durationMs > 0 &&
      vis.activeSustains.has(prevSn.chartIndex) &&
      !isSustainTailPastCanvasBottom(hitLineY, pxPerMs, prevEnd, positionMs, height)
    ) {
      i -= 1;
      continue;
    }
    break;
  }

  for (; i < n; i++) {
    const { note, chartIndex } = sortedNotes[i]!;
    if (vis.goneTap.has(chartIndex)) continue;
    if (vis.missSlide.has(chartIndex)) continue;
    if (occluded.has(chartIndex) && !vis.activeSustains.has(chartIndex)) {
      continue;
    }

    const headT = noteHeadTimeMs(note, L);
    const endMs = noteTailTimeMs(note, L);

    if (headT > tHigh + TIME_EPSILON_MS) break;

    if (endMs < tLow - TIME_EPSILON_MS) {
      const activeHold = note.durationMs > 0 && vis.activeSustains.has(chartIndex);
      if (
        !activeHold ||
        isSustainTailPastCanvasBottom(hitLineY, pxPerMs, endMs, positionMs, height)
      ) {
        continue;
      }
    }

    const timeUntil = headT - positionMs;
    const lane = note.lane;
    const cx = laneCenterX(lane, laneWidth);
    const cy = yFromTime(hitLineY, pxPerMs, headT, positionMs);
    const pulse = timeUntil > 900 || timeUntil < -900 ? 0 : 1 - Math.abs(timeUntil) / 900;
    const sustain = vis.activeSustains.get(chartIndex);
    const holdStripOnly = note.durationMs > 0 && sustain?.headHidden === true;
    if (sustain?.completed && positionMs >= endMs - TIME_EPSILON_MS) {
      vis.activeSustains.delete(chartIndex);
      continue;
    }

    const approach = approachFade(timeUntil, lookAheadMs);
    const noteR = noteRadius * anticipationScale(timeUntil);

    if (note.durationMs > 0) {
      const cyTail = yFromTime(hitLineY, pxPerMs, endMs, positionMs);
      const cyHeadBar = holdStripOnly
        ? hitLineY + noteR
        : yFromTime(hitLineY, pxPerMs, headT, positionMs) + noteR;
      const h = Math.abs(cyTail - cyHeadBar);
      if (sustain && h > SUSTAIN_MIN_HEIGHT_PX) {
        list.painted.add(chartIndex);
      }
      if (h <= SUSTAIN_MIN_HEIGHT_PX) {
        if (sustain?.completed || positionMs >= endMs - TIME_EPSILON_MS) {
          vis.goneTap.add(chartIndex);
          vis.activeSustains.delete(chartIndex);
        }
        continue;
      }
      const it = nextItem(list);
      it.kind = holdStripOnly ? DRAW_SUSTAIN_HELD : DRAW_SUSTAIN;
      it.chartIndex = chartIndex;
      it.lane = lane;
      it.cx = cx;
      it.cy = cy;
      it.cyHeadBar = cyHeadBar;
      it.cyTail = cyTail;
      it.radius = noteR;
      it.baseRadius = noteRadius;
      it.approach = approach;
      it.pulse = pulse;
      it.timeUntilMs = timeUntil;
      it.progress01 = holdProgress01(positionMs, headT, endMs);
    }

    if (!holdStripOnly) {
      const it = nextItem(list);
      it.kind = DRAW_GEM;
      it.chartIndex = chartIndex;
      it.lane = lane;
      it.cx = cx;
      it.cy = cy;
      it.cyHeadBar = cy;
      it.cyTail = cy;
      it.radius = noteR;
      it.baseRadius = noteRadius;
      it.approach = approach;
      it.pulse = pulse;
      it.timeUntilMs = timeUntil;
      it.progress01 = 0;
    }
  }
}

/** Active sustains whose tail has left the canvas are finished, painted or not. */
function reapOffScreenSustains(
  chartNotes: readonly Note[],
  vis: NoteVisibility,
  hitLineY: number,
  pxPerMs: number,
  positionMs: number,
  height: number
): void {
  for (const [idx, sustain] of vis.activeSustains) {
    const note = chartNotes[idx];
    if (!note || note.durationMs <= 0) {
      vis.goneTap.add(idx);
      vis.activeSustains.delete(idx);
      continue;
    }
    if (
      isSustainTailPastCanvasBottom(hitLineY, pxPerMs, sustain.endTime, positionMs, height)
    ) {
      vis.goneTap.add(idx);
      vis.activeSustains.delete(idx);
    }
  }
}

/**
 * A hold whose head has scrolled off the top of the scan window still needs its
 * body drawn. The scan above never reaches those notes, so they are picked up here.
 *
 * The old code duplicated the entire sustain paint block for this case; the two
 * copies differed only in using the un-popped radius, which is unobservable —
 * anything reaching this path is well outside the ±100ms anticipation window.
 */
function emitUnpaintedActiveSustains(
  list: DrawList,
  chartNotes: readonly Note[],
  vis: NoteVisibility,
  frame: HighwayFrame,
  L: number
): void {
  if (vis.activeSustains.size === 0) return;
  const { laneWidth, noteRadius, hitLineY, pxPerMs, positionMs, lookAheadMs, h: height } = frame;

  for (const [idx, sustain] of vis.activeSustains) {
    if (list.painted.has(idx)) continue;
    const note = chartNotes[idx];
    if (!note || note.durationMs <= 0) continue;
    if (vis.goneTap.has(idx) || vis.missSlide.has(idx)) continue;
    const headT = noteHeadTimeMs(note, L);
    const endT = noteTailTimeMs(note, L);
    if (
      isSustainTailPastCanvasBottom(hitLineY, pxPerMs, sustain.endTime, positionMs, height) ||
      positionMs > endT + TIME_EPSILON_MS
    ) {
      continue;
    }
    const lane = note.lane;
    const timeUntil = headT - positionMs;
    const noteR = noteRadius * anticipationScale(timeUntil);
    const holdStripOnly = sustain.headHidden === true;
    const cyTail = yFromTime(hitLineY, pxPerMs, endT, positionMs);
    const cy = yFromTime(hitLineY, pxPerMs, headT, positionMs);
    const cyHeadBar = holdStripOnly ? hitLineY + noteR : cy + noteR;
    const h = Math.abs(cyTail - cyHeadBar);
    if (h <= SUSTAIN_MIN_HEIGHT_PX) continue;

    const it = nextItem(list);
    it.kind = holdStripOnly ? DRAW_SUSTAIN_HELD : DRAW_SUSTAIN;
    it.chartIndex = idx;
    it.lane = lane;
    it.cx = laneCenterX(lane, laneWidth);
    it.cy = cy;
    it.cyHeadBar = cyHeadBar;
    it.cyTail = cyTail;
    it.radius = noteR;
    it.baseRadius = noteRadius;
    it.approach = approachFade(timeUntil, lookAheadMs);
    it.pulse = timeUntil > 900 || timeUntil < -900 ? 0 : 1 - Math.abs(timeUntil) / 900;
    it.timeUntilMs = timeUntil;
    it.progress01 = holdProgress01(positionMs, headT, endT);
    list.painted.add(idx);
  }
}

/** Missed / bad notes: keep scrolling until past the bottom edge, then drop from the set. */
function emitMissSlidingNotes(
  list: DrawList,
  chartNotes: readonly Note[],
  vis: NoteVisibility,
  frame: HighwayFrame,
  L: number
): void {
  const missSlide = vis.missSlide;
  if (missSlide.size === 0) return;
  const { laneWidth, noteRadius, hitLineY, pxPerMs, positionMs, h: height } = frame;

  for (const idx of missSlide) {
    const note = chartNotes[idx];
    if (!note) {
      missSlide.delete(idx);
      continue;
    }

    const headT = noteHeadTimeMs(note, L);
    const endMs = noteTailTimeMs(note, L);
    const lane = note.lane;
    const cx = laneCenterX(lane, laneWidth);
    const cy = yFromTime(hitLineY, pxPerMs, headT, positionMs);
    const cyTail = yFromTime(hitLineY, pxPerMs, endMs, positionMs);
    const cyHeadBar = note.durationMs > 0 ? cy + noteRadius : cy;
    const bottom = Math.max(cyHeadBar, cyTail);

    if (bottom > height + OFF_SCREEN_BOTTOM_PAD) {
      missSlide.delete(idx);
      continue;
    }

    if (note.durationMs > 0) {
      const it = nextItem(list);
      it.kind = DRAW_MISS_SUSTAIN;
      it.chartIndex = idx;
      it.lane = lane;
      it.cx = cx;
      it.cy = cy;
      it.cyHeadBar = cyHeadBar;
      it.cyTail = cyTail;
      it.radius = noteRadius;
      it.baseRadius = noteRadius;
      it.approach = 1;
      it.pulse = 0.35;
      it.timeUntilMs = headT - positionMs;
      it.progress01 = 0;
    }

    const it = nextItem(list);
    it.kind = DRAW_MISS_GEM;
    it.chartIndex = idx;
    it.lane = lane;
    it.cx = cx;
    it.cy = cy;
    it.cyHeadBar = cy;
    it.cyTail = cy;
    it.radius = noteRadius;
    it.baseRadius = noteRadius;
    it.approach = 1;
    it.pulse = 0.35;
    it.timeUntilMs = headT - positionMs;
    it.progress01 = 0;
  }
}

/**
 * Distance fade, and the anticipation swell.
 *
 * The **defaults here are geometry**, shared by every theme, because `radius`
 * feeds `cyHeadBar` — the sustain body's head end. If two themes disagreed about
 * the pop, they would disagree about where a hold starts, and the occlusion maths
 * would differ between them. So the scan always uses these values.
 *
 * A theme that wants a different *fade* or a different *gem size* passes its own
 * floor/pop here using the item's `timeUntilMs`, and applies the result to what it
 * draws — never back into the geometry. That is how `void` gets a deeper fade and
 * a bigger pop without touching where anything is.
 */
export const APPROACH_FLOOR = 0.6;
export const ANTICIPATION_POP = 0.08;

export function approachFade(
  timeUntilMs: number,
  lookAheadMs: number,
  floor: number = APPROACH_FLOOR
): number {
  return Math.min(1, Math.max(floor, 1 - (timeUntilMs - 80) / Math.max(lookAheadMs, 1)));
}

export function anticipationScale(
  timeUntilMs: number,
  pop: number = ANTICIPATION_POP
): number {
  const t =
    timeUntilMs > 100 || timeUntilMs < -60
      ? 0
      : Math.max(0, 1 - Math.abs(timeUntilMs) / 100);
  return 1 + t * pop;
}

function holdProgress01(positionMs: number, headT: number, endT: number): number {
  const span = endT - headT;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (positionMs - headT) / span));
}
