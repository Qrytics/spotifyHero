import { describe, it, expect } from "vitest";
import {
  PARTICLE_CAP,
  SHAKE_AMP_GOOD,
  SHAKE_AMP_MISS,
  SHAKE_AMP_PERFECT,
  SHAKE_MAX_PX,
  SHAKE_MS,
  clearHighwayFx,
  createHighwayFx,
  pruneHighwayFx,
  shakeAmpForJudgement,
  spawnHitEffect,
  triggerShake,
  updateShake,
  type SpawnFeel,
} from "../fxState.js";
import { HIT_FX_MS, LANE_COUNT } from "../highwayConstants.js";

const CLASSIC_FEEL: SpawnFeel = {
  screenShake: false,
  particleCount: 10,
  particleUpwardCone: false,
};
const VOID_FEEL: SpawnFeel = {
  screenShake: true,
  particleCount: 8,
  particleUpwardCone: true,
};

describe("shakeAmpForJudgement", () => {
  it("kicks hardest on a failure — a miss should feel worse than a perfect", () => {
    expect(shakeAmpForJudgement("miss")).toBe(SHAKE_AMP_MISS);
    expect(shakeAmpForJudgement("bad")).toBe(SHAKE_AMP_MISS);
    expect(shakeAmpForJudgement("perfect")).toBe(SHAKE_AMP_PERFECT);
    expect(shakeAmpForJudgement("great")).toBe(SHAKE_AMP_GOOD);
    expect(shakeAmpForJudgement("good")).toBe(SHAKE_AMP_GOOD);
    expect(SHAKE_AMP_MISS).toBeGreaterThan(SHAKE_AMP_PERFECT);
  });
});

describe("updateShake", () => {
  it("writes 0 offsets when nothing has fired", () => {
    const fx = createHighwayFx();
    updateShake(fx.shake, 1000, false);
    expect(fx.shake.ox).toBe(0);
    expect(fx.shake.oy).toBe(0);
  });

  it("stays inside the clamp for the whole envelope, on every direction", () => {
    const fx = createHighwayFx();
    triggerShake(fx.shake, SHAKE_AMP_MISS, 0, false);
    for (let t = 0; t <= SHAKE_MS; t += 1) {
      updateShake(fx.shake, t, false);
      expect(Math.abs(fx.shake.ox)).toBeLessThanOrEqual(SHAKE_MAX_PX + 1e-9);
      expect(Math.abs(fx.shake.oy)).toBeLessThanOrEqual(SHAKE_MAX_PX + 1e-9);
    }
  });

  it("settles to exactly 0 once the envelope ends", () => {
    const fx = createHighwayFx();
    triggerShake(fx.shake, SHAKE_AMP_MISS, 0, false);
    updateShake(fx.shake, SHAKE_MS + 1, false);
    expect(fx.shake.ox).toBe(0);
    expect(fx.shake.oy).toBe(0);
  });

  it("decays: a late sample is never larger than the peak", () => {
    const fx = createHighwayFx();
    triggerShake(fx.shake, SHAKE_AMP_MISS, 0, false);
    let peak = 0;
    for (let t = 0; t <= 40; t += 1) {
      updateShake(fx.shake, t, false);
      peak = Math.max(peak, Math.hypot(fx.shake.ox, fx.shake.oy));
    }
    updateShake(fx.shake, 130, false);
    expect(Math.hypot(fx.shake.ox, fx.shake.oy)).toBeLessThan(peak);
  });

  it("is a no-op under reduced motion, both to trigger and to read", () => {
    const fx = createHighwayFx();
    triggerShake(fx.shake, SHAKE_AMP_MISS, 0, true);
    expect(fx.shake.amp).toBe(0);
    // Even an already-armed shake reads as zero while the preference is on.
    triggerShake(fx.shake, SHAKE_AMP_MISS, 0, false);
    updateShake(fx.shake, 10, true);
    expect(fx.shake.ox).toBe(0);
    expect(fx.shake.oy).toBe(0);
  });

  it("never allocates: ox/oy are written in place", () => {
    const fx = createHighwayFx();
    const shake = fx.shake;
    triggerShake(shake, SHAKE_AMP_PERFECT, 0, false);
    updateShake(shake, 10, false);
    expect(fx.shake).toBe(shake);
  });
});

describe("spawnHitEffect", () => {
  it("shakes only when the theme's feel asks for it", () => {
    const classic = createHighwayFx();
    spawnHitEffect(classic, 0, "perfect", 10, 20, "#fff", 0, false, CLASSIC_FEEL);
    expect(classic.shake.amp).toBe(0);

    const dark = createHighwayFx();
    spawnHitEffect(dark, 0, "perfect", 10, 20, "#fff", 0, false, VOID_FEEL);
    expect(dark.shake.amp).toBe(SHAKE_AMP_PERFECT);
  });

  it("spawns the feel's particle count, and none under reduced motion", () => {
    const a = createHighwayFx();
    spawnHitEffect(a, 1, "great", 10, 20, "#fff", 0, false, CLASSIC_FEEL);
    expect(a.particles.length).toBe(10);

    const b = createHighwayFx();
    spawnHitEffect(b, 1, "great", 10, 20, "#fff", 0, false, VOID_FEEL);
    expect(b.particles.length).toBe(8);

    const c = createHighwayFx();
    spawnHitEffect(c, 1, "great", 10, 20, "#fff", 0, true, VOID_FEEL);
    expect(c.particles.length).toBe(0);
  });

  it("throws void's particles upward and classic's in a full circle", () => {
    const dark = createHighwayFx();
    spawnHitEffect(dark, 2, "perfect", 10, 20, "#fff", 0, false, VOID_FEEL);
    // Canvas Y grows downward, so "upward" is vy < 0 for every particle.
    for (const p of dark.particles) expect(p.vy).toBeLessThan(0);

    const classic = createHighwayFx();
    spawnHitEffect(classic, 2, "perfect", 10, 20, "#fff", 0, false, CLASSIC_FEEL);
    expect(classic.particles.some((p) => p.vy > 0)).toBe(true);
  });

  it("flashes the lane and the strike line on a good hit only", () => {
    const good = createHighwayFx();
    spawnHitEffect(good, 3, "good", 10, 20, "#fff", 0, false, VOID_FEEL);
    expect(good.laneFlashes.length).toBe(1);
    expect(good.hitFlash).toBe(1);

    const bad = createHighwayFx();
    spawnHitEffect(bad, 3, "miss", 10, 20, "#fff", 0, false, VOID_FEEL);
    expect(bad.laneFlashes.length).toBe(0);
    expect(bad.hitFlash).toBe(0);
    // A miss still pops the receptor and prints its label.
    expect(bad.receptorPop[3]?.t0).toBe(0);
    expect(bad.judgementTexts.length).toBe(1);
  });

  it("stores the judgement, not a colour — so a theme switch repaints old text", () => {
    const fx = createHighwayFx();
    spawnHitEffect(fx, 0, "perfect", 10, 20, "#BF5FFF", 0, false, VOID_FEEL);
    expect(fx.judgementTexts[0]?.judgement).toBe("perfect");
    expect(Object.keys(fx.judgementTexts[0] ?? {})).not.toContain("color");
  });

  it("caps its unbounded arrays under sustained density", () => {
    const fx = createHighwayFx();
    for (let i = 0; i < 400; i++) {
      spawnHitEffect(fx, i % LANE_COUNT, "perfect", 10, 20, "#fff", i, false, VOID_FEEL);
    }
    expect(fx.particles.length).toBeLessThanOrEqual(PARTICLE_CAP);
    expect(fx.hitEffects.length).toBeLessThanOrEqual(14);
    expect(fx.judgementTexts.length).toBeLessThanOrEqual(16);
  });
});

describe("pruneHighwayFx", () => {
  it("ages out each effect on its own clock", () => {
    const fx = createHighwayFx();
    spawnHitEffect(fx, 0, "perfect", 10, 20, "#fff", 0, false, VOID_FEEL);
    fx.edgePulse = { color: "#fff", t0: 0 };

    pruneHighwayFx(fx, 50, HIT_FX_MS);
    expect(fx.hitEffects.length).toBe(1);
    expect(fx.laneFlashes.length).toBe(1); // 90ms life, still inside it at t=50
    expect(fx.particles.length).toBe(8);

    pruneHighwayFx(fx, 1000, HIT_FX_MS);
    expect(fx.hitEffects.length).toBe(0);
    expect(fx.particles.length).toBe(0);
    expect(fx.judgementTexts.length).toBe(0);
    expect(fx.edgePulse).toBe(null);
  });

  it("keeps a lane flash inside its own 90ms window", () => {
    const fx = createHighwayFx();
    spawnHitEffect(fx, 0, "perfect", 10, 20, "#fff", 0, false, VOID_FEEL);
    pruneHighwayFx(fx, 80, HIT_FX_MS);
    expect(fx.laneFlashes.length).toBe(1);
    pruneHighwayFx(fx, 100, HIT_FX_MS);
    expect(fx.laneFlashes.length).toBe(0);
  });

  it("decays the strike-line flash linearly over 140ms", () => {
    const fx = createHighwayFx();
    spawnHitEffect(fx, 0, "perfect", 10, 20, "#fff", 0, false, VOID_FEEL);
    pruneHighwayFx(fx, 70, HIT_FX_MS);
    expect(fx.hitFlash).toBeCloseTo(0.5, 10);
    pruneHighwayFx(fx, 141, HIT_FX_MS);
    expect(fx.hitFlash).toBe(0);
  });
});

describe("clearHighwayFx", () => {
  it("empties everything a replay/seek must not carry over", () => {
    const fx = createHighwayFx();
    spawnHitEffect(fx, 0, "perfect", 10, 20, "#fff", 0, false, VOID_FEEL);
    fx.edgePulse = { color: "#fff", t0: 0 };
    fx.comboBreakAt = 5;

    clearHighwayFx(fx);

    expect(fx.hitEffects.length).toBe(0);
    expect(fx.laneFlashes.length).toBe(0);
    expect(fx.judgementTexts.length).toBe(0);
    expect(fx.particles.length).toBe(0);
    expect(fx.edgePulse).toBe(null);
    expect(fx.shake.amp).toBe(0);
    expect(fx.shake.ox).toBe(0);
    expect(fx.comboBreakAt).toBe(-Infinity);
    expect(fx.hitFlash).toBe(0);
    // Per-lane press state survives: a key held across a seek is still held.
    expect(fx.receptorPress.length).toBe(LANE_COUNT);
  });
});
