import { describe, it, expect } from "vitest";
import {
  createHighwayFrame,
  hitLineYFromHeight,
  isSustainTailPastCanvasBottom,
  laneCenterX,
  noteRadiusFromViewport,
  yFromTime,
} from "../highwayGeometry.js";
import {
  HIT_LINE_BOTTOM_PAD,
  LANE_COUNT,
  LOOK_AHEAD_MS,
  OFF_SCREEN_BOTTOM_PAD,
} from "../highwayConstants.js";

/**
 * Invariant I1: highway geometry is frozen. `hitLineY` in particular is where
 * every existing user's `playbackTimingOffsetMs` was calibrated, so these are
 * regression locks on *exact numbers*, not sanity checks. If one of these fails,
 * the fix is to restore the geometry — not to update the expectation.
 */

describe("noteRadiusFromViewport", () => {
  it("is 12 at the 180px default overlay width", () => {
    // 180/4 = 45px lane; 45 * 0.18 = 8.1, clamped up to the 12px floor.
    expect(noteRadiusFromViewport(180, 420)).toBe(12);
  });

  it("clamps to [12, 30]", () => {
    expect(noteRadiusFromViewport(40, 200)).toBe(12);
    expect(noteRadiusFromViewport(4000, 800)).toBe(30);
  });

  it("scales with lane width between the clamps", () => {
    // 640/4 = 160px lane; 160 * 0.18 = 28.8, inside the range.
    expect(noteRadiusFromViewport(640, 800)).toBeCloseTo(28.8, 10);
  });

  it("ignores height entirely", () => {
    expect(noteRadiusFromViewport(500, 100)).toBe(noteRadiusFromViewport(500, 10000));
  });
});

describe("hitLineYFromHeight", () => {
  it("leaves exactly HIT_LINE_BOTTOM_PAD below the outer target ring", () => {
    const h = 420;
    const r = 12;
    const y = hitLineYFromHeight(h, r);
    expect(y).toBe(420 - 17 - HIT_LINE_BOTTOM_PAD);
    // The ring's bottom edge (r + 5) must sit the pad above the canvas bottom.
    expect(h - (y + r + 5)).toBe(HIT_LINE_BOTTOM_PAD);
  });

  it("pins the default overlay geometry", () => {
    expect(hitLineYFromHeight(420, noteRadiusFromViewport(180, 420))).toBe(399);
  });
});

describe("yFromTime", () => {
  const hitLineY = 399;
  const pxPerMs = hitLineY / LOOK_AHEAD_MS;

  it("puts a note exactly on the hit line when it is due now", () => {
    expect(yFromTime(hitLineY, pxPerMs, 5000, 5000)).toBe(hitLineY);
  });

  it("puts a note a full lookahead away at the top edge", () => {
    expect(yFromTime(hitLineY, pxPerMs, 5000 + LOOK_AHEAD_MS, 5000)).toBeCloseTo(0, 10);
  });

  it("is linear and monotonic in the playhead", () => {
    const a = yFromTime(hitLineY, pxPerMs, 5000, 4000);
    const b = yFromTime(hitLineY, pxPerMs, 5000, 4500);
    const c = yFromTime(hitLineY, pxPerMs, 5000, 5000);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(b - a).toBeCloseTo(c - b, 10);
  });

  it("returns values below the hit line for notes already past", () => {
    expect(yFromTime(hitLineY, pxPerMs, 4900, 5000)).toBeGreaterThan(hitLineY);
  });
});

describe("isSustainTailPastCanvasBottom", () => {
  const height = 420;
  const hitLineY = 399;
  const pxPerMs = hitLineY / LOOK_AHEAD_MS;

  it("is false while the tail is still on screen", () => {
    expect(isSustainTailPastCanvasBottom(hitLineY, pxPerMs, 5000, 5000, height)).toBe(false);
  });

  it("is true only once the tail clears the bottom pad", () => {
    // Time at which cyTail === height + pad exactly.
    const edgeMs = (height + OFF_SCREEN_BOTTOM_PAD - hitLineY) / pxPerMs;
    expect(isSustainTailPastCanvasBottom(hitLineY, pxPerMs, 0, edgeMs - 1, height)).toBe(false);
    expect(isSustainTailPastCanvasBottom(hitLineY, pxPerMs, 0, edgeMs + 1, height)).toBe(true);
  });
});

describe("laneCenterX", () => {
  it("centres each lane and spaces them by one lane width", () => {
    const laneWidth = 180 / LANE_COUNT;
    expect(laneCenterX(0, laneWidth)).toBe(22.5);
    for (let lane = 1; lane < LANE_COUNT; lane++) {
      expect(laneCenterX(lane, laneWidth) - laneCenterX(lane - 1, laneWidth)).toBeCloseTo(
        laneWidth,
        10
      );
    }
  });
});

describe("createHighwayFrame", () => {
  it("starts at the frozen default lookahead so a pre-first-frame read is sane", () => {
    const f = createHighwayFrame();
    expect(f.lookAheadMs).toBe(LOOK_AHEAD_MS);
    expect(f.dpr).toBe(1);
    expect(f.reducedMotion).toBe(false);
    expect(f.combo).toBe(0);
  });
});
