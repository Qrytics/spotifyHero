import type { HighwayThemeId, Judgement } from "@spotifyhero/shared-types";
import type { HighwayFrame } from "../highwayGeometry.js";
import type { DrawList } from "../noteDrawList.js";
import type { HighwayFx } from "../fxState.js";

/**
 * A theme is a frozen vtable, not a palette-plus-flags record.
 *
 * The two looks differ in **primitives**, not in colours: one sprite blit versus
 * three `arc` calls, beat rungs versus dashed speed lines, lane tint fills versus
 * no lane fill at all. A flags record would need one flag per structural
 * difference, each gating a branch in the hottest loop in the app, and every
 * future theme would widen the same type. A vtable keeps each look readable
 * top-to-bottom — which is how art actually gets tuned — and physically separates
 * the disposable pixels from the shared, fragile scan in `noteDrawList.ts`.
 *
 * Themes are module-level frozen singletons: no `this`, no per-frame allocation,
 * resolved by a record lookup.
 *
 * ## The per-frame rule
 *
 * `createLinearGradient`, `createRadialGradient`, `shadowBlur` and `ctx.save()`
 * may not appear in anything reachable from the rAF loop. Every gradient is built
 * once into the theme's surface; every soft shape is a pre-rendered sprite blit.
 * This is greppable, and reviewed as such — see `README.md`.
 */

/** Cached per (theme, size, dpr). Rebuilt only on resize / DPR change / theme switch. */
export type ClassicSurface = {
  readonly kind: "classic";
  readonly bg: HTMLCanvasElement;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
};

export type VoidSurface = {
  readonly kind: "void";
  /** Backdrop, floor glow, vignette, rails, strike line, receptor pools. */
  readonly bg: HTMLCanvasElement;
  /** Flat gem body per lane. */
  readonly gemBody: readonly HTMLCanvasElement[];
  /** Bloom halo per lane — separate sprite so all bloom blits in one additive pass. */
  readonly gemBloom: readonly HTMLCanvasElement[];
  /** Hueless white flash, reused for impact, press glow and hold contact flare. */
  readonly gemFlash: HTMLCanvasElement;
  /** Sprite side length in CSS px — sprites are square. */
  readonly gemSizeCss: number;
  readonly horizonFade: CanvasGradient;
  /**
   * Flat hold-body fill per lane. A plain colour, not a gradient: the horizontal
   * ramp this replaced read as a cylinder, which was the one volume cue left after
   * the gems went flat.
   */
  readonly sustainTube: readonly string[];
  /** Bottom-anchored lane column, one per lane — the hit flash. */
  readonly laneFlash: readonly CanvasGradient[];
  /** Lane-tinted edge vignette for the combo-milestone burst. */
  readonly edgeVignette: readonly CanvasGradient[];
  readonly railEnergy: CanvasGradient;
  readonly comboDim: CanvasGradient;
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
};

export type HighwaySurface = ClassicSurface | VoidSurface;

/**
 * Shell-side behaviours that differ per look but are **not** draw calls: they are
 * read once per judged note, not per frame. A record rather than vtable methods
 * because `fxState.ts` consumes them and must not import a theme.
 */
export type HighwayFeel = {
  /** Classic did not shake; adding it there would change the look it exists to preserve. */
  readonly screenShake: boolean;
  readonly particleCount: number;
  /** `false` = the original full-circle burst; `true` = an upward ±55° cone. */
  readonly particleUpwardCone: boolean;
};

export type HighwayTheme = {
  readonly id: HighwayThemeId;
  /** Painted under the cached backdrop blit, including on the paused-resize path. */
  readonly clearColor: string;
  /** This theme's lane palette. Classic keeps the pre-overhaul neons. */
  laneHex(lane: number): string;
  readonly feel: HighwayFeel;
  /**
   * `ctx` is the **live** canvas context, passed in only so cached gradients are
   * created from the context that will paint them. A `CanvasGradient` is portable
   * between contexts in every engine, but there is no reason to rely on that.
   */
  buildSurface(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dpr: number
  ): HighwaySurface;
  /** Behind the notes: beat grid, combo rail energy. */
  drawBackdropFx(ctx: CanvasRenderingContext2D, s: HighwaySurface, f: HighwayFrame, fx: HighwayFx): void;
  drawNotes(ctx: CanvasRenderingContext2D, s: HighwaySurface, f: HighwayFrame, list: DrawList): void;
  /** Between notes and receptors — the far fade, so distant notes dim but hits never do. */
  drawOverlay(ctx: CanvasRenderingContext2D, s: HighwaySurface, f: HighwayFrame, fx: HighwayFx): void;
  drawReceptors(ctx: CanvasRenderingContext2D, s: HighwaySurface, f: HighwayFrame, fx: HighwayFx): void;
  /**
   * Strike accent, lane flash, rings, sparks, judgement text, edge pulse.
   *
   * Deliberately one call rather than six: they share one state object, always
   * draw in the same relative order, and bundling lets a theme set
   * `globalCompositeOperation` once for the whole additive group.
   */
  drawImpactFx(ctx: CanvasRenderingContext2D, s: HighwaySurface, f: HighwayFrame, fx: HighwayFx): void;
  judgementRingColor(j: Judgement): string;
  judgementTextColor(j: Judgement): string;
};
