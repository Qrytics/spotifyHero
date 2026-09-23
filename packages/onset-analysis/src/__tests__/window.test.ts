/**
 * The frame ↔ time mapping every other module agrees on. Cheap to test, and the
 * thing a "why is the chart 20 ms off" bug hunt starts at.
 */
import { describe, expect, it } from "vitest";
import { frameAtTimeMs, frameGeometry, frameTimeMs, hannWindow } from "../window.js";
import { SR } from "./signals.js";

describe("hannWindow", () => {
  it("is periodic, not symmetric", () => {
    const w = hannWindow(8);
    // Periodic Hann starts at 0 and never returns to 0 — w[n] = w[size - n].
    expect(w[0]!).toBeCloseTo(0, 12);
    expect(w[4]!).toBeCloseTo(1, 12);
    expect(w[1]!).toBeCloseTo(w[7]!, 12);
    expect(w[3]!).toBeCloseTo(w[5]!, 12);
    // The symmetric variant would put a 0 here; the periodic one does not.
    expect(w[7]!).toBeGreaterThan(0);
  });

  it("stays within 0..1", () => {
    for (const v of hannWindow(64)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("frame geometry", () => {
  const geo = frameGeometry(2048, 512, SR);

  it("derives the documented 11.6 ms hop", () => {
    expect(geo.hopMs).toBeCloseTo(11.61, 2);
  });

  it("maps frame 0 to time 0 — centred framing, no half-window offset", () => {
    // If this ever becomes fftSize/2 the whole chart shifts by 23 ms.
    expect(frameTimeMs(0, geo)).toBe(0);
  });

  it("keeps sub-hop precision for an interpolated peak", () => {
    expect(frameTimeMs(10.5, geo)).toBeCloseTo(10.5 * geo.hopMs, 9);
  });

  it("round-trips through frameAtTimeMs", () => {
    for (const frame of [1, 7, 128, 20_700]) {
      expect(frameAtTimeMs(frameTimeMs(frame, geo), geo)).toBe(frame);
    }
  });
});
