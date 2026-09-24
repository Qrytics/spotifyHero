import { describe, it, expect } from "vitest";
import type { Note } from "@spotifyhero/shared-types";
import { CHART_LEAD_IN_MS } from "@spotifyhero/gameplay-core";
import {
  ANTICIPATION_POP,
  APPROACH_FLOOR,
  DRAW_GEM,
  DRAW_MISS_GEM,
  DRAW_MISS_SUSTAIN,
  DRAW_SUSTAIN,
  DRAW_SUSTAIN_HELD,
  anticipationScale,
  approachFade,
  buildDrawList,
  createDrawList,
  type DrawItem,
  type DrawList,
} from "../noteDrawList.js";
import {
  createHighwayFrame,
  hitLineYFromHeight,
  laneCenterX,
  noteRadiusFromViewport,
  yFromTime,
  type HighwayFrame,
} from "../highwayGeometry.js";
import {
  EMPTY_OCCLUDED,
  buildSortedNotes,
  createNoteVisibility,
  type NoteVisibility,
} from "../noteVisibility.js";
import { LANE_COUNT, LOOK_AHEAD_MS, SUSTAIN_MIN_HEIGHT_PX } from "../highwayConstants.js";

/**
 * The note scan. This is the shared, fragile half of the renderer — both themes
 * read this list, so a bug here is *not* fixable by switching look. These tests
 * exist because step 3 of the overhaul rewrote this logic out of `paintNotes`,
 * where it had no coverage at all.
 */

const W = 180;
const H = 420;
const NOTE_R = noteRadiusFromViewport(W, H); // 12
const HIT_Y = hitLineYFromHeight(H, NOTE_R); // 399

function frameAt(positionMs: number, lookAheadMs = LOOK_AHEAD_MS): HighwayFrame {
  const f = createHighwayFrame();
  f.w = W;
  f.h = H;
  f.laneWidth = W / LANE_COUNT;
  f.noteRadius = NOTE_R;
  f.hitLineY = HIT_Y;
  f.pxPerMs = HIT_Y / lookAheadMs;
  f.lookAheadMs = lookAheadMs;
  f.positionMs = positionMs;
  return f;
}

function tap(timeMs: number, lane: number): Note {
  return { timeMs, lane, durationMs: 0 };
}
function hold(timeMs: number, lane: number, durationMs: number): Note {
  return { timeMs, lane, durationMs };
}

/** Run one frame of the scan and return the live items as a plain array. */
function scan(
  notes: readonly Note[],
  positionMs: number,
  opts: {
    list?: DrawList;
    vis?: NoteVisibility;
    occluded?: ReadonlySet<number>;
    lookAheadMs?: number;
  } = {}
): { list: DrawList; vis: NoteVisibility; items: DrawItem[]; frame: HighwayFrame } {
  const list = opts.list ?? createDrawList();
  const vis = opts.vis ?? createNoteVisibility();
  const frame = frameAt(positionMs, opts.lookAheadMs ?? LOOK_AHEAD_MS);
  buildDrawList(
    list,
    buildSortedNotes(notes),
    notes,
    vis,
    opts.occluded ?? EMPTY_OCCLUDED,
    frame
  );
  return { list, vis, items: list.items.slice(0, list.length), frame };
}

// ---------------------------------------------------------------------------
// Fade / pop — deliberately parameterised, deliberately geometry-neutral
// ---------------------------------------------------------------------------

describe("approachFade", () => {
  it("is 1 at and past the strike line", () => {
    expect(approachFade(0, 2200)).toBe(1);
    expect(approachFade(-500, 2200)).toBe(1);
    expect(approachFade(80, 2200)).toBe(1);
  });

  it("bottoms out at the floor for a far note", () => {
    expect(approachFade(2200, 2200)).toBe(APPROACH_FLOOR);
    expect(approachFade(99999, 2200)).toBe(APPROACH_FLOOR);
  });

  it("takes a per-theme floor without affecting the default", () => {
    // Void fades deeper (0.45) than classic (0.6) — same geometry, dimmer paint.
    expect(approachFade(2200, 2200, 0.45)).toBe(0.45);
    expect(approachFade(2200, 2200)).toBe(APPROACH_FLOOR);
  });

  it("is monotonic in distance", () => {
    let prev = 1.0001;
    for (let t = 0; t <= 2400; t += 100) {
      const v = approachFade(t, 2200);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it("survives a zero lookahead without dividing by zero", () => {
    expect(Number.isFinite(approachFade(100, 0))).toBe(true);
  });
});

describe("anticipationScale", () => {
  it("peaks exactly on the note and is 1 outside the window", () => {
    expect(anticipationScale(0)).toBe(1 + ANTICIPATION_POP);
    expect(anticipationScale(101)).toBe(1);
    expect(anticipationScale(-61)).toBe(1);
  });

  it("is asymmetric: it swells from 100ms out and holds until 60ms past", () => {
    // Exclusive at the early edge, inclusive at the late one — so the pop dies
    // abruptly on approach and lingers a frame after the note is judged.
    expect(anticipationScale(100)).toBe(1);
    expect(anticipationScale(99)).toBeGreaterThan(1);
    expect(anticipationScale(-60)).toBeGreaterThan(1);
    expect(anticipationScale(-61)).toBe(1);
  });

  it("takes a per-theme pop", () => {
    expect(anticipationScale(0, 0.14)).toBeCloseTo(1.14, 10);
  });
});

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

describe("buildDrawList — taps", () => {
  it("emits one gem per visible tap, at the right lane and Y", () => {
    const notes = [tap(2000, 0), tap(2500, 3)];
    const { items, frame } = scan(notes, 1000);

    expect(items.length).toBe(2);
    expect(items[0]?.kind).toBe(DRAW_GEM);
    expect(items[0]?.lane).toBe(0);
    expect(items[0]?.cx).toBe(laneCenterX(0, frame.laneWidth));
    expect(items[0]?.cy).toBeCloseTo(yFromTime(HIT_Y, frame.pxPerMs, 2000, 1000), 10);
    expect(items[1]?.lane).toBe(3);
  });

  it("puts a due note exactly on the hit line", () => {
    const { items } = scan([tap(5000, 1)], 5000);
    expect(items[0]?.cy).toBe(HIT_Y);
  });

  it("excludes notes beyond the lookahead window", () => {
    // 2200ms lookahead + 780ms scroll-in slack; 9000ms out is far past that.
    expect(scan([tap(9000, 0)], 0).items.length).toBe(0);
    expect(scan([tap(2000, 0)], 0).items.length).toBe(1);
  });

  it("includes notes slightly above the top edge so they scroll in, not pop in", () => {
    // A note 2400ms out is past the 2200ms lookahead but inside SCROLL_IN_EXTRA_MS.
    const { items } = scan([tap(2400, 0)], 0);
    expect(items.length).toBe(1);
    expect(items[0]?.cy).toBeLessThan(0);
  });

  it("keeps drawing a just-passed tap until it is judged", () => {
    const { items } = scan([tap(5000, 1)], 5200);
    expect(items.length).toBe(1);
    expect(items[0]?.cy).toBeGreaterThan(HIT_Y);
  });

  it("drops a tap once visibility says it is gone", () => {
    const vis = createNoteVisibility();
    vis.goneTap.add(0);
    expect(scan([tap(5000, 1)], 5000, { vis }).items.length).toBe(0);
  });

  it("scales lookahead: a faster scroll speed shows fewer notes", () => {
    const notes = [tap(500, 0), tap(1500, 1), tap(2100, 2)];
    const slow = scan(notes, 0, { lookAheadMs: LOOK_AHEAD_MS }).items.length;
    const fast = scan(notes, 0, { lookAheadMs: LOOK_AHEAD_MS / 5 }).items.length;
    expect(fast).toBeLessThan(slow);
  });
});

describe("buildDrawList — occlusion", () => {
  it("skips an occluded note", () => {
    const notes = [hold(2000, 0, 1000), tap(2500, 0)];
    const occluded = new Set([1]);
    const { items } = scan(notes, 1500, { occluded });
    expect(items.some((i) => i.chartIndex === 1)).toBe(false);
  });

  it("still draws an occluded note if it is a hold currently being held", () => {
    // The strip is live; suppressing it would blank a hold mid-press.
    const notes = [hold(2000, 0, 1000), hold(2500, 0, 400)];
    const vis = createNoteVisibility();
    vis.activeSustains.set(1, {
      id: 1,
      startTime: 2500,
      endTime: 2900,
      headHidden: true,
      completed: false,
    });
    const { items } = scan(notes, 2600, { vis, occluded: new Set([1]) });
    expect(items.some((i) => i.chartIndex === 1)).toBe(true);
  });
});

describe("buildDrawList — sustains", () => {
  it("emits the body before the gem, so the gem paints on top", () => {
    const { items } = scan([hold(2000, 2, 600)], 1500);
    expect(items.length).toBe(2);
    expect(items[0]?.kind).toBe(DRAW_SUSTAIN);
    expect(items[1]?.kind).toBe(DRAW_GEM);
    expect(items[0]?.chartIndex).toBe(items[1]?.chartIndex);
  });

  it("offsets the body's head end past the gem centre so the cap overlaps it", () => {
    const { items } = scan([hold(2000, 2, 600)], 1500);
    const body = items[0]!;
    expect(body.cyHeadBar).toBeCloseTo(body.cy + body.radius, 10);
  });

  it("exposes baseRadius unaffected by the anticipation pop — the width-wobble fix", () => {
    // Inside the ±100ms window the gem pops, but the body width must not.
    const popped = scan([hold(5000, 0, 600)], 5000).items[0]!;
    const calm = scan([hold(5000, 0, 600)], 4000).items[0]!;
    expect(popped.radius).toBeGreaterThan(popped.baseRadius);
    expect(popped.baseRadius).toBe(NOTE_R);
    expect(calm.baseRadius).toBe(NOTE_R);
    expect(calm.radius).toBe(NOTE_R);
  });

  it("hides the head gem once the hold is being held, keeping the strip", () => {
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 2000,
      endTime: 2600,
      headHidden: true,
      completed: false,
    });
    const { items } = scan([hold(2000, 2, 600)], 2200, { vis });
    expect(items.length).toBe(1);
    expect(items[0]?.kind).toBe(DRAW_SUSTAIN_HELD);
  });

  it("pins a held strip's head to the strike line, not to the scrolled head time", () => {
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 2000,
      endTime: 2600,
      headHidden: true,
      completed: false,
    });
    const { items } = scan([hold(2000, 2, 600)], 2300, { vis });
    expect(items[0]?.cyHeadBar).toBeCloseTo(HIT_Y + items[0]!.radius, 10);
  });

  it("reports hold progress 0..1 across the hold", () => {
    const vis = createNoteVisibility();
    const setHeld = (): void => {
      vis.activeSustains.set(0, {
        id: 0,
        startTime: 2000,
        endTime: 3000,
        headHidden: true,
        completed: false,
      });
    };
    setHeld();
    expect(scan([hold(2000, 0, 1000)], 2000, { vis }).items[0]?.progress01).toBe(0);
    setHeld();
    expect(scan([hold(2000, 0, 1000)], 2500, { vis }).items[0]?.progress01).toBeCloseTo(0.5, 10);
    setHeld();
    expect(scan([hold(2000, 0, 1000)], 2999, { vis }).items[0]?.progress01).toBeCloseTo(
      0.999,
      3
    );
  });

  it("leaves progress at 0 for taps", () => {
    expect(scan([tap(2000, 0)], 1500).items[0]?.progress01).toBe(0);
  });

  it("drops a held strip rather than drawing a sliver, once it collapses", () => {
    // A held strip's head is pinned at `hitLineY + radius`, so it collapses when
    // the tail has scrolled exactly one radius past the strike line — not when
    // the hold is short. That is the only way `h` reaches SUSTAIN_MIN_HEIGHT_PX.
    const pxPerMs = HIT_Y / LOOK_AHEAD_MS;
    const collapseAt = 2600 + NOTE_R / pxPerMs;
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 2000,
      endTime: 2600,
      headHidden: true,
      completed: false,
    });
    const { items } = scan([hold(2000, 0, 600)], collapseAt, { vis });
    expect(items.length).toBe(0);
    // And it is retired, not left to re-appear next frame.
    expect(vis.activeSustains.has(0)).toBe(false);
    expect(vis.goneTap.has(0)).toBe(true);
  });

  it("an unheld hold's strip is never shorter than the head cap", () => {
    // `h = duration * pxPerMs + radius`, so the collapse branch above is
    // unreachable for a hold whose head gem is still showing.
    for (const durationMs of [1, 10, 60, 600]) {
      const { items } = scan([hold(2000, 0, durationMs)], 1900);
      const body = items.find((i) => i.kind === DRAW_SUSTAIN);
      expect(body).toBeDefined();
      expect(Math.abs(body!.cyTail - body!.cyHeadBar)).toBeGreaterThan(SUSTAIN_MIN_HEIGHT_PX);
    }
  });

  it("marks a completed hold gone exactly at its end, not before", () => {
    const notes = [hold(2000, 0, 600)];
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 2000,
      endTime: 2600,
      headHidden: true,
      completed: true,
    });

    const before = scan(notes, 2500, { vis });
    expect(before.items.length).toBe(1);
    expect(vis.activeSustains.has(0)).toBe(true);

    const after = scan(notes, 2600, { vis });
    expect(after.items.length).toBe(0);
    expect(vis.activeSustains.has(0)).toBe(false);
  });

  it("reaps an active sustain whose tail has scrolled off the bottom", () => {
    const notes = [hold(1000, 0, 200)];
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 1000,
      endTime: 1200,
      headHidden: true,
      completed: false,
    });
    const { items } = scan(notes, 20000, { vis });
    expect(items.length).toBe(0);
    expect(vis.activeSustains.has(0)).toBe(false);
    expect(vis.goneTap.has(0)).toBe(true);
  });

  it("draws a long hold whose head has scrolled above the scan window", () => {
    // 40s hold: the head is far outside the window, but the body is on screen.
    const notes = [hold(1000, 1, 40000)];
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 1000,
      endTime: 41000,
      headHidden: true,
      completed: false,
    });
    const { items } = scan(notes, 20000, { vis });
    expect(items.length).toBe(1);
    expect(items[0]?.kind).toBe(DRAW_SUSTAIN_HELD);
    expect(items[0]?.chartIndex).toBe(0);
  });

  it("emits a long hold's body exactly once, never twice", () => {
    // The old code had two copies of the sustain paint block; this is the
    // regression guard for the collapse into one emit path.
    const notes = [hold(1000, 1, 8000)];
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 1000,
      endTime: 9000,
      headHidden: true,
      completed: false,
    });
    for (const pos of [1000, 2000, 4000, 6000, 8999]) {
      const { items } = scan(notes, pos, { vis });
      const bodies = items.filter(
        (i) => i.chartIndex === 0 && (i.kind === DRAW_SUSTAIN || i.kind === DRAW_SUSTAIN_HELD)
      );
      expect(bodies.length).toBe(1);
      vis.activeSustains.set(0, {
        id: 0,
        startTime: 1000,
        endTime: 9000,
        headHidden: true,
        completed: false,
      });
    }
  });
});

describe("buildDrawList — missed notes", () => {
  it("emits a miss gem and keeps it sliding past the hit line", () => {
    const vis = createNoteVisibility();
    vis.missSlide.add(0);
    // Only ~45px of canvas remain below the strike line, so the whole slide
    // lasts about 250ms at the default scroll rate.
    const { items } = scan([tap(2000, 1)], 2100, { vis });
    expect(items.length).toBe(1);
    expect(items[0]?.kind).toBe(DRAW_MISS_GEM);
    expect(items[0]?.cy).toBeGreaterThan(HIT_Y);
  });

  it("emits body-then-gem for a missed hold", () => {
    const vis = createNoteVisibility();
    vis.missSlide.add(0);
    const { items } = scan([hold(2000, 1, 400)], 2050, { vis });
    expect(items.map((i) => i.kind)).toEqual([DRAW_MISS_SUSTAIN, DRAW_MISS_GEM]);
  });

  it("evicts a missed note once it clears the bottom edge", () => {
    const vis = createNoteVisibility();
    vis.missSlide.add(0);
    const { items } = scan([tap(2000, 1)], 20000, { vis });
    expect(items.length).toBe(0);
    expect(vis.missSlide.has(0)).toBe(false);
  });

  it("never double-draws a missed note through the main scan", () => {
    const vis = createNoteVisibility();
    vis.missSlide.add(0);
    const { items } = scan([tap(2000, 1)], 2000, { vis });
    expect(items.filter((i) => i.chartIndex === 0).length).toBe(1);
  });

  it("evicts a missSlide index that is not in the chart at all", () => {
    const vis = createNoteVisibility();
    vis.missSlide.add(99);
    scan([tap(2000, 1)], 2000, { vis });
    expect(vis.missSlide.has(99)).toBe(false);
  });

  it("uses the un-popped radius for miss slides — they are past judging", () => {
    const vis = createNoteVisibility();
    vis.missSlide.add(0);
    const { items } = scan([tap(2000, 1)], 2000, { vis });
    expect(items[0]?.radius).toBe(NOTE_R);
    expect(items[0]?.baseRadius).toBe(NOTE_R);
  });
});

describe("buildDrawList — pooling", () => {
  it("reuses its item objects across frames instead of allocating", () => {
    const notes = [tap(1000, 0), tap(1100, 1), tap(1200, 2)];
    const list = createDrawList();
    const first = scan(notes, 500, { list });
    const poolSize = list.items.length;
    const firstItem = list.items[0];

    for (let pos = 500; pos < 1300; pos += 50) {
      scan(notes, pos, { list });
    }

    expect(list.items.length).toBe(poolSize);
    expect(list.items[0]).toBe(firstItem);
    expect(first.items.length).toBeGreaterThan(0);
  });

  it("resets length each frame so stale entries are never read", () => {
    const list = createDrawList();
    scan([tap(1000, 0), tap(1100, 1)], 900, { list });
    expect(list.length).toBe(2);
    // Same list, a playhead where nothing is visible.
    scan([tap(1000, 0), tap(1100, 1)], 60000, { list });
    expect(list.length).toBe(0);
    // The pool still holds the old objects; only `length` guards them.
    expect(list.items.length).toBeGreaterThan(0);
  });

  it("clears `painted` each frame", () => {
    const notes = [hold(2000, 0, 500)];
    const list = createDrawList();
    const vis = createNoteVisibility();
    vis.activeSustains.set(0, {
      id: 0,
      startTime: 2000,
      endTime: 2500,
      headHidden: false,
      completed: false,
    });
    scan(notes, 2100, { list, vis });
    expect(list.painted.has(0)).toBe(true);
    scan(notes, 60000, { list, vis });
    expect(list.painted.has(0)).toBe(false);
  });

  it("grows the pool for a dense frame and keeps it", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 200; i++) notes.push(tap(1000 + i * 5, i % LANE_COUNT));
    const list = createDrawList();
    scan(notes, 1000, { list });
    expect(list.length).toBeGreaterThan(64);
    expect(list.items.length).toBeGreaterThanOrEqual(list.length);
  });

  it("handles an empty chart", () => {
    const { items } = scan([], 1000);
    expect(items.length).toBe(0);
  });
});

describe("buildDrawList — CHART_LEAD_IN_MS", () => {
  it("routes note times through the lead-in rather than comparing raw timeMs", () => {
    // Currently 0; this asserts the wiring, so a future non-zero lead-in shifts
    // the drawn Y by exactly the lead-in rather than silently doing nothing.
    const { items, frame } = scan([tap(2000, 0)], 1000);
    expect(items[0]?.cy).toBeCloseTo(
      yFromTime(HIT_Y, frame.pxPerMs, 2000 + CHART_LEAD_IN_MS, 1000),
      10
    );
  });
});
