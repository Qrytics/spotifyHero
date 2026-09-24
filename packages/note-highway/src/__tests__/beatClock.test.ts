import { describe, it, expect } from "vitest";
import {
  FALLBACK_BEAT_MS,
  beatAnchorMs,
  beatIndexAtOrAfter,
  beatPeriodMs,
  beatPhase01,
  beatPulse01,
  beatTimeAt,
} from "../beatClock.js";
import { yFromTime } from "../highwayGeometry.js";

describe("beatPeriodMs", () => {
  it("converts BPM to a period", () => {
    expect(beatPeriodMs(120)).toBe(500);
    expect(beatPeriodMs(60)).toBe(1000);
    expect(beatPeriodMs(174)).toBeCloseTo(344.8276, 4);
  });

  it("falls back on a nonsense BPM rather than producing a useless grid", () => {
    for (const bpm of [0, -1, NaN, Infinity, 5, 2000]) {
      expect(beatPeriodMs(bpm)).toBe(FALLBACK_BEAT_MS);
    }
  });

  it("accepts the edges of the usable range", () => {
    // 80ms <= period <= 3000ms is kept; 750bpm = 80ms, 20bpm = 3000ms.
    expect(beatPeriodMs(750)).toBe(80);
    expect(beatPeriodMs(20)).toBe(3000);
  });
});

describe("beatAnchorMs", () => {
  it("reduces the first note head into one beat period", () => {
    // Spotify's synthetic grid carries a 2000ms phase bias; at 500ms beats that
    // lands exactly on a beat, so the anchor is 0.
    expect(beatAnchorMs(2000, 500)).toBe(0);
    expect(beatAnchorMs(2120, 500)).toBe(120);
  });

  it("is always in [0, beatMs)", () => {
    for (const head of [0, 37, 2000, 123456.7]) {
      const a = beatAnchorMs(head, 344.827);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(344.827);
    }
  });

  it("is 0 for a nonsense head or period", () => {
    expect(beatAnchorMs(NaN, 500)).toBe(0);
    expect(beatAnchorMs(1000, 0)).toBe(0);
  });
});

describe("beatPhase01", () => {
  it("is 0 exactly on a beat and rises toward 1", () => {
    expect(beatPhase01(2000, 500, 0)).toBe(0);
    expect(beatPhase01(2250, 500, 0)).toBe(0.5);
    expect(beatPhase01(2499, 500, 0)).toBeCloseTo(0.998, 3);
    expect(beatPhase01(2500, 500, 0)).toBe(0);
  });

  it("respects the anchor", () => {
    expect(beatPhase01(2120, 500, 120)).toBe(0);
  });

  it("stays in [0, 1) for a negative playhead", () => {
    const p = beatPhase01(-370, 500, 120);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
  });
});

describe("beatPulse01", () => {
  it("decays sharply from 1 on the beat to 0 just before the next", () => {
    expect(beatPulse01(0)).toBe(1);
    expect(beatPulse01(0.5)).toBe(0.125);
    expect(beatPulse01(1)).toBe(0);
  });

  it("clamps out-of-range phases", () => {
    expect(beatPulse01(-1)).toBe(1);
    expect(beatPulse01(2)).toBe(0);
  });

  it("is monotonically decreasing", () => {
    let prev = Infinity;
    for (let p = 0; p <= 1.00001; p += 0.05) {
      const v = beatPulse01(p);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("beatTimeAt / beatIndexAtOrAfter", () => {
  it("round-trips: the beat at or after a beat time is that beat", () => {
    const beatMs = 344.827;
    const anchor = 91.3;
    for (const index of [0, 1, 7, 250]) {
      const t = beatTimeAt(index, beatMs, anchor);
      expect(beatIndexAtOrAfter(t, beatMs, anchor)).toBe(index);
    }
  });

  it("rounds up strictly between beats", () => {
    expect(beatIndexAtOrAfter(501, 500, 0)).toBe(2);
    expect(beatIndexAtOrAfter(999, 500, 0)).toBe(2);
    expect(beatIndexAtOrAfter(1000, 500, 0)).toBe(2);
  });

  it("returns negative indices for times before the anchor", () => {
    expect(beatIndexAtOrAfter(-600, 500, 0)).toBe(-1);
  });
});

/**
 * The reason the beat grid replaced the old speed lines: those scrolled off
 * `performance.now()` unscaled by `noteScrollSpeed`, so they drifted against the
 * notes. The rungs cannot, because they are the same `yFromTime` of the same
 * playhead — this test is that claim, made executable.
 */
describe("beat rungs versus notes", () => {
  it("a note placed on a beat lands on that beat's rung at every playhead", () => {
    const hitLineY = 399;
    const beatMs = beatPeriodMs(128);
    const anchor = beatAnchorMs(2000, beatMs);
    const noteOnBeat = beatTimeAt(12, beatMs, anchor);

    for (const spd of [0.45, 1, 2.5, 5]) {
      const pxPerMs = hitLineY / (2200 / spd);
      for (const pos of [0, 1500, 3999.7, 10000]) {
        const rungY = yFromTime(hitLineY, pxPerMs, beatTimeAt(12, beatMs, anchor), pos);
        const noteY = yFromTime(hitLineY, pxPerMs, noteOnBeat, pos);
        expect(noteY).toBe(rungY);
      }
    }
  });
});
