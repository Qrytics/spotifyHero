import type { Judgement } from "@spotifyhero/shared-types";
import { LANE_COUNT } from "./highwayConstants.js";

/**
 * Transient visual effects. Owned by the highway mount, mutated by score events
 * and pruned once per frame; themes only ever read it.
 */

export type HitFx = { lane: number; judgement: Judgement; t0: number };
export type LaneFlashFx = { lane: number; t0: number };
/**
 * Stores the **judgement**, not a resolved colour string. A mid-round theme
 * switch would otherwise leave up to 520ms of text painted in the old theme's
 * palette.
 */
export type JudgementTextFx = { lane: number; judgement: Judgement; t0: number };
export type ParticleFx = {
  lane: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  lifeMs: number;
  color: string;
};
export type ReceptorPopFx = { t0: number };
export type EdgePulseFx = { color: string; t0: number };

export type ReceptorPressState = {
  isDown: boolean;
  downAt: number;
  upAt: number;
};

/**
 * Screen shake, applied as a **canvas transform**, not a CSS transform on the
 * wrapper. Three reasons: the wrapper is `contain: strict; overflow: hidden`, so
 * translating it exposes unpainted edges; a CSS transform can force compositor
 * re-raster of a DPR-2 canvas every frame; and shaking inside the canvas lets
 * the cached background stay at identity, so only the notes and fx move — which
 * reads as impact rather than as the whole overlay jittering.
 */
export type ShakeState = {
  t0: number;
  /** Amplitude in CSS px, pre-decay. */
  amp: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  /** Written by `updateShake` — read by the loop. */
  ox: number;
  oy: number;
};

export const SHAKE_MS = 140;
export const SHAKE_MAX_PX = 3;
export const SHAKE_AMP_PERFECT = 1.6;
export const SHAKE_AMP_GOOD = 1.1;
export const SHAKE_AMP_MISS = 2.6;

export const JUDGEMENT_TEXT_MS = 520;
export const LANE_FLASH_MS = 90;
export const EDGE_PULSE_MS = 260;
export const COMBO_BREAK_MS = 180;
export const PARTICLE_LIFE_MS = 220;
/**
 * Kept at classic's 180 rather than dropped to void's 120: the cap only bites
 * under extreme density, and lowering it would be a (tiny) change to the look
 * classic exists to preserve. Void spawns 8 per hit with a 220ms life, so it
 * peaks around 30 alive and never reaches either number.
 */
export const PARTICLE_CAP = 180;
export const PARTICLES_PER_HIT_VOID = 8;

export type HighwayFx = {
  hitEffects: HitFx[];
  laneFlashes: LaneFlashFx[];
  judgementTexts: JudgementTextFx[];
  particles: ParticleFx[];
  receptorPop: ReceptorPopFx[];
  receptorPress: ReceptorPressState[];
  edgePulse: EdgePulseFx | null;
  shake: ShakeState;
  /** `performance.now()` of the last combo break, or -Infinity. */
  comboBreakAt: number;
  /** Strike-line brightening 0..1, decayed from the most recent good hit. */
  hitFlash: number;
  hitFlashAt: number;
};

export function createHighwayFx(): HighwayFx {
  return {
    hitEffects: [],
    laneFlashes: [],
    judgementTexts: [],
    particles: [],
    receptorPop: Array.from({ length: LANE_COUNT }, () => ({ t0: -Infinity })),
    receptorPress: Array.from({ length: LANE_COUNT }, () => ({
      isDown: false,
      downAt: -Infinity,
      upAt: -Infinity,
    })),
    edgePulse: null,
    shake: { t0: -Infinity, amp: 0, dx: 0, dy: 0, ox: 0, oy: 0 },
    comboBreakAt: -Infinity,
    hitFlash: 0,
    hitFlashAt: -Infinity,
  };
}

export function clearHighwayFx(fx: HighwayFx): void {
  fx.hitEffects.length = 0;
  fx.laneFlashes.length = 0;
  fx.judgementTexts.length = 0;
  fx.particles.length = 0;
  fx.edgePulse = null;
  fx.shake.t0 = -Infinity;
  fx.shake.amp = 0;
  fx.shake.ox = 0;
  fx.shake.oy = 0;
  fx.comboBreakAt = -Infinity;
  fx.hitFlash = 0;
  fx.hitFlashAt = -Infinity;
}

export function triggerShake(
  shake: ShakeState,
  amp: number,
  now: number,
  reducedMotion: boolean
): void {
  if (reducedMotion) return;
  const angle = Math.random() * Math.PI * 2;
  shake.t0 = now;
  shake.amp = amp;
  shake.dx = Math.cos(angle);
  shake.dy = Math.sin(angle);
}

/**
 * Damped ~36Hz oscillation. Writes `ox`/`oy` in place rather than returning a
 * tuple — this runs once per frame and must not allocate.
 */
export function updateShake(shake: ShakeState, now: number, reducedMotion: boolean): void {
  if (reducedMotion) {
    shake.ox = 0;
    shake.oy = 0;
    return;
  }
  const t = now - shake.t0;
  if (!(t >= 0) || t > SHAKE_MS || shake.amp <= 0) {
    shake.ox = 0;
    shake.oy = 0;
    return;
  }
  const decay = Math.exp(-t / 70);
  const v = shake.amp * decay * Math.sin(t * 0.226);
  const clamped = Math.max(-SHAKE_MAX_PX, Math.min(SHAKE_MAX_PX, v));
  shake.ox = clamped * shake.dx;
  shake.oy = clamped * shake.dy;
}

export function shakeAmpForJudgement(j: Judgement): number {
  if (j === "miss" || j === "bad") return SHAKE_AMP_MISS;
  if (j === "perfect") return SHAKE_AMP_PERFECT;
  return SHAKE_AMP_GOOD;
}

/**
 * Particle / shake behaviour is per-look, so it arrives as a small record rather
 * than being hardcoded here. `fxState` must not import a theme (themes import it).
 */
export type SpawnFeel = {
  readonly screenShake: boolean;
  readonly particleCount: number;
  readonly particleUpwardCone: boolean;
};

/**
 * Spawn the full burst for one judged note. `cx`/`cy` are the receptor centre in
 * CSS px, resolved by the caller from current viewport dims.
 */
export function spawnHitEffect(
  fx: HighwayFx,
  lane: number,
  judgement: Judgement,
  cx: number,
  cy: number,
  laneColor: string,
  now: number,
  reducedMotion: boolean,
  feel: SpawnFeel
): void {
  fx.hitEffects.push({ lane, judgement, t0: now });
  if (fx.hitEffects.length > 14) fx.hitEffects.splice(0, fx.hitEffects.length - 14);

  const good = judgement !== "miss" && judgement !== "bad";
  if (good) {
    fx.laneFlashes.push({ lane, t0: now });
    fx.hitFlash = 1;
    fx.hitFlashAt = now;
  }
  fx.receptorPop[lane] = { t0: now };
  fx.judgementTexts.push({ lane, judgement, t0: now });
  if (fx.judgementTexts.length > 16) {
    fx.judgementTexts.splice(0, fx.judgementTexts.length - 16);
  }

  if (feel.screenShake) {
    triggerShake(fx.shake, shakeAmpForJudgement(judgement), now, reducedMotion);
  }

  const n = feel.particleCount;
  if (!reducedMotion && n > 0) {
    for (let i = 0; i < n; i++) {
      let angle: number;
      let extraVy = 0;
      if (feel.particleUpwardCone) {
        // Upward ±55° cone: debris thrown off the strike line, not an explosion.
        const spread = (n > 1 ? (i / (n - 1)) * 2 - 1 : 0) * 0.96;
        angle = -Math.PI / 2 + spread + (Math.random() - 0.5) * 0.22;
      } else {
        angle = (Math.PI * 2 * i) / n + Math.random() * 0.25;
        extraVy = -1.4;
      }
      const speed = 0.9 + Math.random() * 1.7;
      fx.particles.push({
        lane,
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + extraVy,
        t0: now,
        lifeMs: PARTICLE_LIFE_MS,
        color: laneColor,
      });
    }
    if (fx.particles.length > PARTICLE_CAP) {
      fx.particles.splice(0, fx.particles.length - PARTICLE_CAP);
    }
  }
}

/** Age out everything expired, once per frame, before any theme reads it. */
export function pruneHighwayFx(fx: HighwayFx, now: number, hitFxMs: number): void {
  for (let i = fx.hitEffects.length - 1; i >= 0; i--) {
    if (now - fx.hitEffects[i]!.t0 > hitFxMs) fx.hitEffects.splice(i, 1);
  }
  for (let i = fx.laneFlashes.length - 1; i >= 0; i--) {
    if (now - fx.laneFlashes[i]!.t0 > LANE_FLASH_MS) fx.laneFlashes.splice(i, 1);
  }
  for (let i = fx.judgementTexts.length - 1; i >= 0; i--) {
    if (now - fx.judgementTexts[i]!.t0 > JUDGEMENT_TEXT_MS) fx.judgementTexts.splice(i, 1);
  }
  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i]!;
    if (now - p.t0 > p.lifeMs) fx.particles.splice(i, 1);
  }
  if (fx.edgePulse && now - fx.edgePulse.t0 > EDGE_PULSE_MS) fx.edgePulse = null;
  const flashAge = now - fx.hitFlashAt;
  fx.hitFlash = flashAge >= 0 && flashAge < 140 ? 1 - flashAge / 140 : 0;
}
