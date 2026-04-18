import { describe, it, expect } from "vitest";
import {
  computePlaybackTimingOffsetFromTaps,
  distToNearestBeat,
} from "./offsetCalibration.js";

describe("distToNearestBeat", () => {
  it("is ~0 on grid", () => {
    expect(distToNearestBeat(500, 500)).toBe(0);
    expect(distToNearestBeat(0, 500)).toBe(0);
  });

  it("returns signed offset to nearest multiple", () => {
    expect(distToNearestBeat(520, 500)).toBe(20);
    expect(distToNearestBeat(480, 500)).toBe(-20);
  });
});

describe("computePlaybackTimingOffsetFromTaps", () => {
  it("returns ~0 when taps sit on beat grid", () => {
    const beatMs = 500;
    const taps = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
    expect(computePlaybackTimingOffsetFromTaps(taps, beatMs)).toBe(0);
  });

  it("suggests negative offset when taps are consistently late", () => {
    const beatMs = 500;
    const late = 80;
    const taps = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map((t) => t + late);
    expect(computePlaybackTimingOffsetFromTaps(taps, beatMs)).toBe(-late);
  });
});
