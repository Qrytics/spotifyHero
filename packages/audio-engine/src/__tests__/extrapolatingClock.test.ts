import { describe, it, expect, beforeEach } from "vitest";
import { PlaybackClockImpl, IGNORE_DRIFT_MS } from "../extrapolatingClock.js";

// ---------------------------------------------------------------------------
// Helpers — a fake monotonic clock so tests never sleep.
// ---------------------------------------------------------------------------

function makeClock() {
  let now = 1000;
  const clock = new PlaybackClockImpl(() => now);
  return {
    clock,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

const TRACK = "track-a";

describe("PlaybackClockImpl", () => {
  let h: ReturnType<typeof makeClock>;

  beforeEach(() => {
    h = makeClock();
  });

  it("starts at 0 and reports not-exact", () => {
    expect(h.clock.estimateMs()).toBe(0);
    expect(h.clock.isExact).toBe(false);
  });

  it("extrapolates at real time while playing", () => {
    h.clock.sync(5_000, true, TRACK);
    h.advance(750);
    expect(h.clock.estimateMs()).toBe(5_750);
    h.advance(1_250);
    expect(h.clock.estimateMs()).toBe(7_000);
  });

  it("holds position while paused", () => {
    h.clock.sync(5_000, false, TRACK);
    h.advance(5_000);
    expect(h.clock.estimateMs()).toBe(5_000);
  });

  // -------------------------------------------------------------------------
  // The IGNORE_DRIFT_MS branch — the reason this class exists.
  // -------------------------------------------------------------------------

  describe("drift handling while playing", () => {
    beforeEach(() => {
      h.clock.sync(10_000, true, TRACK);
      h.advance(1_000); // estimate is now 11_000
      expect(h.clock.estimateMs()).toBe(11_000);
    });

    it("ignores a small positive drift (jitter) — keeps extrapolating", () => {
      h.clock.sync(11_000 + (IGNORE_DRIFT_MS - 1), true, TRACK);
      expect(h.clock.estimateMs()).toBe(11_000);
    });

    it("ignores a small negative drift (jitter)", () => {
      h.clock.sync(11_000 - (IGNORE_DRIFT_MS - 1), true, TRACK);
      expect(h.clock.estimateMs()).toBe(11_000);
    });

    it("ignores drift exactly at the threshold boundary minus epsilon", () => {
      // |drift| < IGNORE_DRIFT_MS is ignored, so == threshold re-anchors.
      h.clock.sync(11_000 + IGNORE_DRIFT_MS, true, TRACK);
      expect(h.clock.estimateMs()).toBe(11_000 + IGNORE_DRIFT_MS);
    });

    it("re-anchors on a large forward drift (seek / scrub)", () => {
      h.clock.sync(30_000, true, TRACK);
      expect(h.clock.estimateMs()).toBe(30_000);
      h.advance(500);
      expect(h.clock.estimateMs()).toBe(30_500);
    });

    it("re-anchors on a large backward drift (replay)", () => {
      h.clock.sync(1_000, true, TRACK);
      expect(h.clock.estimateMs()).toBe(1_000);
    });

    it("does not accumulate ignored jitter", () => {
      // Many small samples in a row must never pull the anchor.
      for (let i = 0; i < 20; i++) {
        h.advance(100);
        h.clock.sync(h.clock.estimateMs() + 50, true, TRACK);
      }
      expect(h.clock.estimateMs()).toBe(13_000);
    });
  });

  // -------------------------------------------------------------------------
  // Re-anchor triggers that bypass the drift filter entirely.
  // -------------------------------------------------------------------------

  it("re-anchors immediately on track change, even for tiny position deltas", () => {
    h.clock.sync(10_000, true, TRACK);
    h.advance(1_000);
    h.clock.sync(10_010, true, "track-b");
    expect(h.clock.estimateMs()).toBe(10_010);
  });

  it("re-anchors when a null trackId arrives", () => {
    h.clock.sync(10_000, true, TRACK);
    h.advance(1_000);
    h.clock.sync(0, false, null);
    h.advance(1_000);
    expect(h.clock.estimateMs()).toBe(0);
  });

  it("re-anchors on pause even when the reported position is close", () => {
    h.clock.sync(10_000, true, TRACK);
    h.advance(1_000);
    h.clock.sync(10_990, false, TRACK);
    h.advance(5_000);
    expect(h.clock.estimateMs()).toBe(10_990);
  });

  it("re-anchors on resume and resumes advancing", () => {
    h.clock.sync(10_000, false, TRACK);
    h.advance(3_000);
    expect(h.clock.estimateMs()).toBe(10_000);

    h.clock.sync(10_000, true, TRACK);
    h.advance(400);
    expect(h.clock.estimateMs()).toBe(10_400);
  });

  it("follows the reported position while staying paused (scrub while paused)", () => {
    h.clock.sync(10_000, false, TRACK);
    h.clock.sync(42_000, false, TRACK);
    expect(h.clock.estimateMs()).toBe(42_000);
    h.clock.sync(7_000, false, TRACK);
    expect(h.clock.estimateMs()).toBe(7_000);
  });

  // -------------------------------------------------------------------------

  it("reset() clears position, play state and track identity", () => {
    h.clock.sync(10_000, true, TRACK);
    h.advance(1_000);
    h.clock.reset();

    expect(h.clock.estimateMs()).toBe(0);
    h.advance(5_000);
    expect(h.clock.estimateMs()).toBe(0);

    // Same trackId must be treated as new after a reset.
    h.clock.sync(500, true, TRACK);
    expect(h.clock.estimateMs()).toBe(500);
  });
});
