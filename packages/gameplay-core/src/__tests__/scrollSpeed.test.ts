import { describe, it, expect } from "vitest";
import { AppSettingsSchema, DifficultySchema } from "@spotifyhero/shared-types";

/** Enum order is easy → expert, which is what the monotonicity check relies on. */
const DIFFICULTIES = DifficultySchema.options;
import {
  DIFFICULTY_SCROLL_SPEED,
  MAX_SCROLL_SPEED,
  MIN_SCROLL_SPEED,
  SCROLL_SPEED_STEP,
  stepScrollSpeed,
} from "../scrollSpeed.js";

describe("DIFFICULTY_SCROLL_SPEED", () => {
  it("covers every difficulty and rises with it", () => {
    const speeds = DIFFICULTIES.map((d) => DIFFICULTY_SCROLL_SPEED[d]);
    expect(speeds).toHaveLength(DIFFICULTIES.length);
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!);
    }
  });

  it("is in range for the schema, which throws rather than clamps", () => {
    for (const d of DIFFICULTIES) {
      const parsed = AppSettingsSchema.parse({
        noteScrollSpeed: DIFFICULTY_SCROLL_SPEED[d],
      });
      expect(parsed.noteScrollSpeed).toBe(DIFFICULTY_SCROLL_SPEED[d]);
    }
  });

  it("matches the schema default at medium, so a fresh install agrees", () => {
    expect(AppSettingsSchema.parse({}).noteScrollSpeed).toBe(
      DIFFICULTY_SCROLL_SPEED.medium
    );
  });
});

describe("stepScrollSpeed", () => {
  it("steps by one increment in each direction", () => {
    expect(stepScrollSpeed(1.3, 1)).toBeCloseTo(1.3 + SCROLL_SPEED_STEP, 10);
    expect(stepScrollSpeed(1.3, -1)).toBeCloseTo(1.3 - SCROLL_SPEED_STEP, 10);
  });

  it("clamps at both ends instead of producing a value the schema rejects", () => {
    expect(stepScrollSpeed(MAX_SCROLL_SPEED, 1)).toBe(MAX_SCROLL_SPEED);
    expect(stepScrollSpeed(MIN_SCROLL_SPEED, -1)).toBe(MIN_SCROLL_SPEED);
  });

  it("does not accumulate float drift over a long hold", () => {
    let v = MIN_SCROLL_SPEED;
    for (let i = 0; i < 200; i++) v = stepScrollSpeed(v, 1);
    expect(v).toBe(MAX_SCROLL_SPEED);
    for (let i = 0; i < 200; i++) v = stepScrollSpeed(v, -1);
    expect(v).toBe(MIN_SCROLL_SPEED);
    // Every intermediate value has to survive the schema, since each arrow
    // press writes settings through `AppSettingsSchema.parse`.
    v = 1;
    for (let i = 0; i < 40; i++) {
      v = stepScrollSpeed(v, 1);
      expect(AppSettingsSchema.parse({ noteScrollSpeed: v }).noteScrollSpeed).toBe(v);
    }
  });
});
