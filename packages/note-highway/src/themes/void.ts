import type { Judgement } from "@spotifyhero/shared-types";
import {
  JUDGEMENT_RING_COLOR,
  JUDGEMENT_TEXT_COLOR,
  LANE_HEX,
  easeOutCubic,
  hexToRgba,
  judgementLabel,
  judgementLabelShort,
  mixHex,
  shadeHex,
} from "../color.js";
import { HIT_FX_MS, HIT_RING_EXPANSION, LANE_COUNT } from "../highwayConstants.js";
import {
  hitLineYFromHeight,
  laneCenterX,
  noteRadiusFromViewport,
  yFromTime,
  type HighwayFrame,
} from "../highwayGeometry.js";
import {
  beatIndexAtOrAfter,
  beatTimeAt,
} from "../beatClock.js";
import {
  DRAW_GEM,
  DRAW_MISS_GEM,
  DRAW_MISS_SUSTAIN,
  DRAW_SUSTAIN,
  DRAW_SUSTAIN_HELD,
  anticipationScale,
  approachFade,
  type DrawItem,
  type DrawList,
} from "../noteDrawList.js";
import {
  COMBO_BREAK_MS,
  EDGE_PULSE_MS,
  JUDGEMENT_TEXT_MS,
  LANE_FLASH_MS,
  PARTICLES_PER_HIT_VOID,
  type HighwayFx,
} from "../fxState.js";
import {
  buildGemBloomSprite,
  buildGemBodySprite,
  buildImpactFlashSprite,
  clampTextX,
  gemSpriteSizeCss,
  judgementFontPx,
  pillPath,
  pillRadii,
  ringStroke,
} from "./primitives.js";
import type { HighwaySurface, HighwayTheme, VoidSurface } from "./types.js";

/**
 * Void — a dark corridor lit only by the notes and the strike line.
 *
 * There is no road surface. The old look drew four full-height lane tints at 9%
 * alpha separated by hard 1px seams, which is exactly why it read as a cheap
 * generated road: flat vertical bands with visible joins are too much structure to
 * be a void and not enough to be a fretboard. Depth here comes from **light** —
 * a floor glow at the strike line, rails that brighten toward the player, and a
 * fade that notes emerge out of — never from perspective. Geometry is frozen
 * (see `highwayGeometry.ts`), so there is no taper and no vanishing point.
 *
 * ## The per-frame rule
 *
 * No `createLinearGradient`, `createRadialGradient`, `shadowBlur` or `ctx.save()`
 * anywhere in this file below `buildSurface`. Verify with:
 *
 * ```
 * grep -nE 'createLinearGradient|createRadialGradient|shadowBlur|ctx\.save' \
 *   packages/note-highway/src/themes/void.ts
 * ```
 *
 * Every gradient is built once per size into `VoidSurface`; every soft edge is a
 * pre-rendered sprite blit. Soft light with no gradient construction and no blur
 * is why this look is *cheaper* per frame than the flat one it replaces — the old
 * code set `shadowBlur` per sustain per frame and stroked ~70 speed-line dashes.
 *
 * `ctx.clip()` is banned for the same reason `ctx.save()` is: undoing a clip needs
 * a save/restore pair. Where the old code would have clipped (the sustain energy
 * bands), the band is clamped to the strip's straight section instead.
 */

const RAIL_HEX = "#7C8CB4";
const RAIL_COUNT = LANE_COUNT + 1;

function voidHex(lane: number): string {
  return LANE_HEX[lane] ?? "#ffffff";
}

// ---------------------------------------------------------------------------
// Surface — built once per (size, dpr)
// ---------------------------------------------------------------------------

function buildSurface(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number
): HighwaySurface {
  const noteRadius = noteRadiusFromViewport(w, h);
  const hitLineY = hitLineYFromHeight(h, noteRadius);
  const laneWidth = w / LANE_COUNT;

  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.floor(w * dpr));
  off.height = Math.max(1, Math.floor(h * dpr));
  const o = off.getContext("2d");
  if (o) {
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintVoidBackdrop(o, w, h, laneWidth, noteRadius, hitLineY);
  }

  const gemBody: HTMLCanvasElement[] = [];
  const gemBloom: HTMLCanvasElement[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    gemBody.push(buildGemBodySprite(voidHex(lane), noteRadius, dpr));
    gemBloom.push(buildGemBloomSprite(voidHex(lane), noteRadius, dpr));
  }

  // Notes emerge from darkness instead of popping in at y = 0. Highest value per
  // line of any single thing in this theme.
  const horizonFade = ctx.createLinearGradient(0, 0, 0, h * 0.26);
  horizonFade.addColorStop(0, "rgba(4,4,10,0.92)");
  horizonFade.addColorStop(0.38, "rgba(4,4,10,0.55)");
  horizonFade.addColorStop(1, "rgba(4,4,10,0)");

  // Flat ribbon, one fill per lane. The horizontal ramp that used to be here made
  // the hold read as a cylinder; with the gems flat it was the only thing left
  // implying volume. Kept a shade under the gem so the head still reads as a head.
  const sustainTube: string[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    sustainTube.push(shadeHex(voidHex(lane), 0.78));
  }

  // Bottom-anchored column. The old hit flash was a full-height 0.3-alpha lane
  // rect, which in a void reads as a rendering bug rather than as impact.
  const laneFlash: CanvasGradient[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const g = ctx.createLinearGradient(0, hitLineY - 70, 0, hitLineY + 10);
    g.addColorStop(0, hexToRgba(voidHex(lane), 0));
    g.addColorStop(1, hexToRgba(voidHex(lane), 0.28));
    laneFlash.push(g);
  }

  const edgeVignette: CanvasGradient[] = [];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.36,
      w / 2,
      h / 2,
      Math.max(w, h)
    );
    g.addColorStop(0, hexToRgba(voidHex(lane), 0));
    g.addColorStop(1, hexToRgba(voidHex(lane), 1));
    edgeVignette.push(g);
  }

  // "The highway is charging up" — bottom-weighted, so combo reads even at 180px.
  const railEnergy = ctx.createLinearGradient(0, hitLineY * 0.25, 0, hitLineY);
  railEnergy.addColorStop(0, "rgba(150,180,255,0)");
  railEnergy.addColorStop(0.6, "rgba(170,195,255,0.45)");
  railEnergy.addColorStop(1, "rgba(215,230,255,1)");

  // Combo break: the lights go out.
  const comboDim = ctx.createLinearGradient(0, hitLineY - 120, 0, hitLineY + 12);
  comboDim.addColorStop(0, "rgba(0,0,0,0)");
  comboDim.addColorStop(1, "rgba(0,0,0,1)");

  return {
    kind: "void",
    bg: off,
    gemBody,
    gemBloom,
    gemFlash: buildImpactFlashSprite(noteRadius, dpr),
    gemSizeCss: gemSpriteSizeCss(noteRadius),
    horizonFade,
    sustainTube,
    laneFlash,
    edgeVignette,
    railEnergy,
    comboDim,
    w,
    h,
    dpr,
  };
}

function paintVoidBackdrop(
  o: CanvasRenderingContext2D,
  w: number,
  h: number,
  laneWidth: number,
  noteRadius: number,
  hitLineY: number
): void {
  // Backdrop. Its only job is to stop banding — the road is gone, not replaced.
  o.fillStyle = "#04040A";
  o.fillRect(0, 0, w, h);
  const base = o.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#05050B");
  base.addColorStop(0.62, "#03030A");
  base.addColorStop(1, "#06060E");
  o.fillStyle = base;
  o.fillRect(0, 0, w, h);

  // Floor glow — the primary depth cue. The strike line is the only light source.
  const floorR = Math.max(w, h * 0.55);
  const floor = o.createRadialGradient(w / 2, hitLineY, 0, w / 2, hitLineY, floorR);
  floor.addColorStop(0, "rgba(120,140,255,0.055)");
  floor.addColorStop(1, "rgba(120,140,255,0)");
  o.globalCompositeOperation = "lighter";
  o.fillStyle = floor;
  o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = "source-over";

  // Vignette. Essential at 180px: it pulls the eye into the corridor.
  const vig = o.createRadialGradient(
    w / 2,
    h * 0.45,
    0.35 * Math.min(w, h),
    w / 2,
    h * 0.45,
    Math.max(w, h)
  );
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
  o.fillStyle = vig;
  o.fillRect(0, 0, w, h);

  paintRails(o, w, h, laneWidth);
  paintStrikeLine(o, w, hitLineY);
  paintReceptorPools(o, laneWidth, noteRadius, hitLineY);
}

/**
 * Five rails, not three. With the lane surface gone, the two **outer** rails are
 * what give the highway a shape at all. Neutral cool grey rather than lane hues:
 * four colours over five rails is ambiguous, and chroma belongs to the gems.
 */
function paintRails(
  o: CanvasRenderingContext2D,
  w: number,
  h: number,
  laneWidth: number
): void {
  const halo = o.createLinearGradient(0, 0, 0, h);
  halo.addColorStop(0, hexToRgba(RAIL_HEX, 0.008));
  halo.addColorStop(0.55, hexToRgba(RAIL_HEX, 0.02));
  halo.addColorStop(0.93, hexToRgba(RAIL_HEX, 0.06));
  halo.addColorStop(1, hexToRgba(RAIL_HEX, 0.034));

  const core = o.createLinearGradient(0, 0, 0, h);
  core.addColorStop(0, hexToRgba(RAIL_HEX, 0.06));
  core.addColorStop(0.55, hexToRgba(RAIL_HEX, 0.16));
  core.addColorStop(0.93, hexToRgba(RAIL_HEX, 0.5));
  core.addColorStop(1, hexToRgba(RAIL_HEX, 0.28));

  const coreOuter = o.createLinearGradient(0, 0, 0, h);
  coreOuter.addColorStop(0, hexToRgba(RAIL_HEX, 0.075));
  coreOuter.addColorStop(0.55, hexToRgba(RAIL_HEX, 0.2));
  coreOuter.addColorStop(0.93, hexToRgba(RAIL_HEX, 0.625));
  coreOuter.addColorStop(1, hexToRgba(RAIL_HEX, 0.35));

  for (let i = 0; i < RAIL_COUNT; i++) {
    const outer = i === 0 || i === RAIL_COUNT - 1;
    const rawX = i * laneWidth;
    const coreW = outer ? 1.5 : 1;
    // Clamp the outer two inside the canvas, or half of each falls off the edge.
    const x = outer
      ? Math.max(0, Math.min(w - coreW, i === 0 ? 0 : w - coreW))
      : Math.round(rawX) - 0.5;

    o.fillStyle = halo;
    o.fillRect(x + coreW / 2 - 2.5, 0, 5, h);
    o.fillStyle = outer ? coreOuter : core;
    o.fillRect(x, 0, coreW, h);
  }
}

/** Thin and laser-bright instead of the old 3px grey slab plus Spotify-green bar. */
function paintStrikeLine(o: CanvasRenderingContext2D, w: number, hitLineY: number): void {
  const bloom = o.createLinearGradient(0, hitLineY - 14, 0, hitLineY + 10);
  bloom.addColorStop(0, "rgba(160,190,255,0)");
  bloom.addColorStop(0.58, "rgba(160,190,255,0.1)");
  bloom.addColorStop(1, "rgba(160,190,255,0)");
  o.globalCompositeOperation = "lighter";
  o.fillStyle = bloom;
  o.fillRect(0, hitLineY - 14, w, 24);
  o.globalCompositeOperation = "source-over";

  o.fillStyle = "rgba(232,240,255,0.92)";
  o.fillRect(0, hitLineY - 0.75, w, 1.5);
  o.fillStyle = "rgba(120,150,255,0.35)";
  o.fillRect(0, hitLineY + 2.5, w, 1);
}

/**
 * A pool of light, not a disc. The old receptor painted `rgba(0,0,0,0.38)` behind
 * the ring, which only worked because there was a lane surface to punch through;
 * over a void it renders as a grey blob.
 *
 * The static halo sits at `noteRadius + 6` and the *dynamic* ring at `+3.5`, on
 * purpose: the old code stroked `noteRadius + 2` in both layers every frame, so
 * the resting target was a doubled, muddied line.
 */
function paintReceptorPools(
  o: CanvasRenderingContext2D,
  laneWidth: number,
  noteRadius: number,
  hitLineY: number
): void {
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const cx = laneCenterX(lane, laneWidth);
    const hex = voidHex(lane);
    const r = noteRadius + 10;
    const pool = o.createRadialGradient(cx, hitLineY, 0, cx, hitLineY, r);
    pool.addColorStop(0, hexToRgba(hex, 0.1));
    pool.addColorStop(1, hexToRgba(hex, 0));
    o.globalCompositeOperation = "lighter";
    o.fillStyle = pool;
    o.beginPath();
    o.arc(cx, hitLineY, r, 0, Math.PI * 2);
    o.fill();
    o.globalCompositeOperation = "source-over";

    o.strokeStyle = hexToRgba(hex, 0.16);
    o.lineWidth = 1;
    o.beginPath();
    o.arc(cx, hitLineY, noteRadius + 6, 0, Math.PI * 2);
    o.stroke();
  }
}

// ---------------------------------------------------------------------------
// Per-frame
// ---------------------------------------------------------------------------

/**
 * Void's own fade floor and pop, applied to what is *drawn* only. The scan keeps
 * classic's values because `radius` feeds the sustain head geometry — see the note
 * in `noteDrawList.ts`.
 */
const VOID_APPROACH_FLOOR = 0.45;
const VOID_POP = 0.14;
/** 22.8px in a 45px lane at 180px — narrower than the 24px gem, with dark gutters. */
const SUSTAIN_WIDTH_FACTOR = 1.9;
/** Above this many visible notes, bloom is shed. The one fill-rate valve. */
const BLOOM_NOTE_BUDGET = 18;
const MAX_BEAT_RUNGS = 64;

function voidApproach(f: HighwayFrame, it: DrawItem): number {
  return approachFade(it.timeUntilMs, f.lookAheadMs, VOID_APPROACH_FLOOR);
}

/**
 * Distance shrink × anticipation pop. A far gem is smaller *and* dimmer *and*
 * behind more fade — three depth cues, none of them perspective.
 */
function gemScale(it: DrawItem, approach: number): number {
  return (0.78 + 0.22 * approach) * anticipationScale(it.timeUntilMs, VOID_POP);
}

/**
 * Beat rungs, replacing the speed lines entirely.
 *
 * Positions come from `yFromTime` — the same function the notes use, fed the same
 * playhead — so they move exactly with the notes and scale with `noteScrollSpeed`.
 * The old speed lines scrolled off `performance.now()` at a fixed rate and visibly
 * drifted; that is fixed here by construction rather than patched.
 */
function drawBackdropFx(
  ctx: CanvasRenderingContext2D,
  s: HighwaySurface,
  f: HighwayFrame,
  fx: HighwayFx
): void {
  if (s.kind !== "void") return;

  const { hitLineY, pxPerMs, positionMs, beatMs, beatAnchorMs: anchor, laneWidth, w } = f;
  if (beatMs > 0 && pxPerMs > 0) {
    let index = beatIndexAtOrAfter(positionMs, beatMs, anchor);
    for (let n = 0; n < MAX_BEAT_RUNGS; n++, index++) {
      const t = beatTimeAt(index, beatMs, anchor);
      const y = yFromTime(hitLineY, pxPerMs, t, positionMs);
      if (y < -4) break;
      if (y > hitLineY + 1) continue;
      // Near rungs bright, far rungs almost gone — depth without perspective.
      const depth = 0.25 + 0.75 * (hitLineY > 0 ? y / hitLineY : 0);
      const isBar = ((index % 4) + 4) % 4 === 0;
      const yy = Math.round(y) - 0.5;
      if (isBar) {
        ctx.fillStyle = `rgba(150,170,255,${(0.2 * depth).toFixed(4)})`;
        ctx.fillRect(0, yy, w, 1);
      } else {
        ctx.fillStyle = `rgba(140,160,220,${(0.09 * depth).toFixed(4)})`;
        ctx.fillRect(1, yy, w - 2, 1);
      }
    }
  }

  // Rail energy ramps with combo.
  const energy = Math.min(1, f.combo / 60);
  if (energy > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.1 * energy;
    ctx.fillStyle = s.railEnergy;
    for (let i = 0; i < RAIL_COUNT; i++) {
      const x = Math.min(w - 2.5, Math.max(0, Math.round(i * laneWidth) - 1.25));
      ctx.fillRect(x, 0, 2.5, hitLineY);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Combo break: the lights go out over the rail band.
  const breakAge = f.nowMs - fx.comboBreakAt;
  if (breakAge >= 0 && breakAge < COMBO_BREAK_MS) {
    ctx.globalAlpha = (1 - breakAge / COMBO_BREAK_MS) * 0.25;
    ctx.fillStyle = s.comboDim;
    ctx.fillRect(0, hitLineY - 120, w, 132);
    ctx.globalAlpha = 1;
  }
}

/**
 * Multi-pass, so `globalCompositeOperation` switches a fixed number of times per
 * frame instead of twice per note. Pass order:
 *   1. additive sustain glow   2. sustain tubes + flow + caps
 *   3. additive gem bloom      4. gem bodies      5. misses
 */
function drawNotes(
  ctx: CanvasRenderingContext2D,
  s: HighwaySurface,
  f: HighwayFrame,
  list: DrawList
): void {
  if (s.kind !== "void") return;
  const bloom = list.length <= BLOOM_NOTE_BUDGET;

  if (bloom) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < list.length; i++) {
      const it = list.items[i]!;
      if (it.kind !== DRAW_SUSTAIN && it.kind !== DRAW_SUSTAIN_HELD) continue;
      const bodyW = it.baseRadius * SUSTAIN_WIDTH_FACTOR;
      const top = snapHalf(Math.min(it.cyHeadBar, it.cyTail));
      const bot = snapHalf(Math.max(it.cyHeadBar, it.cyTail));
      const h = bot - top;
      if (h <= 0.5) continue;
      ctx.globalAlpha = 0.16 * voidApproach(f, it);
      ctx.fillStyle = voidHex(it.lane);
      pillPath(ctx, it.cx, top - 1.5, bot + 1.5, bodyW + 3, pillRadii(bodyW + 3, h + 3));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  for (let i = 0; i < list.length; i++) {
    const it = list.items[i]!;
    if (it.kind !== DRAW_SUSTAIN && it.kind !== DRAW_SUSTAIN_HELD) continue;
    drawSustainTube(ctx, s, f, it);
  }

  if (bloom) {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < list.length; i++) {
      const it = list.items[i]!;
      if (it.kind !== DRAW_GEM) continue;
      const approach = voidApproach(f, it);
      ctx.globalAlpha = 0.34 * approach;
      blitSprite(
        ctx,
        s.gemBloom[it.lane] ?? s.gemFlash,
        it.cx,
        it.cy,
        s.gemSizeCss,
        gemScale(it, approach)
      );
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  for (let i = 0; i < list.length; i++) {
    const it = list.items[i]!;
    if (it.kind !== DRAW_GEM) continue;
    const approach = voidApproach(f, it);
    const scale = gemScale(it, approach);
    ctx.globalAlpha = approach;
    blitSprite(ctx, s.gemBody[it.lane] ?? s.gemFlash, it.cx, it.cy, s.gemSizeCss, scale);
    // The instant it crosses the line.
    if (Math.abs(it.timeUntilMs) < 24) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35;
      blitSprite(ctx, s.gemFlash, it.cx, it.cy, s.gemSizeCss, scale);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.globalAlpha = 1;

  // Miss = loss of light: no bloom, body dimmed, red rim.
  for (let i = 0; i < list.length; i++) {
    const it = list.items[i]!;
    if (it.kind === DRAW_MISS_SUSTAIN) {
      const bodyW = it.baseRadius * SUSTAIN_WIDTH_FACTOR;
      const top = snapHalf(Math.min(it.cyHeadBar, it.cyTail));
      const bot = snapHalf(Math.max(it.cyHeadBar, it.cyTail));
      const h = bot - top;
      if (h <= 0.5) continue;
      const radii = pillRadii(bodyW, h);
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = shadeHex(voidHex(it.lane), 0.6);
      pillPath(ctx, it.cx, top, bot, bodyW, radii);
      ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "rgba(255,90,110,0.7)";
      ctx.lineWidth = 1.2;
      pillPath(ctx, it.cx, top, bot, bodyW, radii);
      ctx.stroke();
      continue;
    }
    if (it.kind === DRAW_MISS_GEM) {
      ctx.globalAlpha = 0.3;
      blitSprite(ctx, s.gemBody[it.lane] ?? s.gemFlash, it.cx, it.cy, s.gemSizeCss, 1);
      ctx.globalAlpha = 1;
      ringStroke(ctx, it.cx, it.cy, it.baseRadius, "rgba(255,90,110,0.9)", 1.4);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSustainTube(
  ctx: CanvasRenderingContext2D,
  s: VoidSurface,
  f: HighwayFrame,
  it: DrawItem
): void {
  const held = it.kind === DRAW_SUSTAIN_HELD;
  const bodyW = it.baseRadius * SUSTAIN_WIDTH_FACTOR;
  // Snap to half-pixels: sub-pixel cap edges shimmer as the strip scrolls.
  const top = snapHalf(Math.min(it.cyHeadBar, it.cyTail));
  const bot = snapHalf(Math.max(it.cyHeadBar, it.cyTail));
  const h = bot - top;
  if (h <= 0.5) return;
  const radii = pillRadii(bodyW, h);
  const rCap = radii[0];

  ctx.globalAlpha = held ? 0.95 : 0.88 * voidApproach(f, it);
  ctx.fillStyle = s.sustainTube[it.lane] ?? voidHex(it.lane);
  pillPath(ctx, it.cx, top, bot, bodyW, radii);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Energy flowing down the hold, on the beat.
  //
  // The old shimmer was `sin(nowMs * 0.012 + chartIndex)` — a per-note sine on the
  // wall clock, unrelated to the music, which kept animating under a paused song.
  // This is derived from the playhead, so it freezes when the music does.
  const flowSpan = h - rCap * 2;
  if (flowSpan > 6) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = mixHex(voidHex(it.lane), "#ffffff", 0.5);
    for (let k = 0; k < 2; k++) {
      const phase = (f.beatPhase01 + k * 0.5) % 1;
      const bandY = top + rCap + phase * flowSpan;
      const bandH = Math.min(14, flowSpan - (bandY - (top + rCap)));
      if (bandH <= 1) continue;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(it.cx - bodyW / 2, bandY, bodyW, bandH);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // Tail cap highlight — the far end reads as a lit edge rather than a cut.
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(it.cx - bodyW * 0.3, top + 0.5, bodyW * 0.6, 1.5);

  // A held note should look welded to the receptor, not floating above it.
  if (held) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    blitSprite(ctx, s.gemFlash, it.cx, f.hitLineY, s.gemSizeCss, 0.55);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  s: HighwaySurface,
  f: HighwayFrame
): void {
  if (s.kind !== "void") return;
  // After the notes so it dims the far ones; before the fx so a hit at the line
  // is never dimmed.
  ctx.fillStyle = s.horizonFade;
  ctx.fillRect(0, 0, f.w, f.h * 0.26);
}

function drawReceptors(
  ctx: CanvasRenderingContext2D,
  s: HighwaySurface,
  f: HighwayFrame,
  fx: HighwayFx
): void {
  if (s.kind !== "void") return;
  const { laneWidth, noteRadius, hitLineY, nowMs } = f;

  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const cx = laneCenterX(lane, laneWidth);
    const hex = voidHex(lane);
    const age = nowMs - (fx.receptorPop[lane]?.t0 ?? -Infinity);
    const popping = age >= 0 && age < 120;
    const bump = popping ? 1 + Math.sin((1 - age / 120) * Math.PI) * 0.3 : 1;
    // Beat-synced breathing, replacing an invisible second ring that wobbled off
    // the wall clock and cost four strokes a frame.
    const idle = 0.38 + 0.22 * f.beatPulse01;
    ringStroke(ctx, cx, hitLineY, (noteRadius + 3.5) * bump, hexToRgba(hex, idle), 1.6);

    const p = fx.receptorPress[lane];
    if (!p) continue;
    const justReleased = !p.isDown && nowMs - p.upAt < 90;
    if (!p.isDown && !justReleased) continue;
    const pressAge = p.isDown
      ? Math.min(1, (nowMs - p.downAt) / 90)
      : Math.max(0, 1 - (nowMs - p.upAt) / 90);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.3 + pressAge * 0.3;
    blitSprite(ctx, s.gemFlash, cx, hitLineY, s.gemSizeCss, 0.85 + pressAge * 0.15);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ringStroke(
      ctx,
      cx,
      hitLineY,
      noteRadius + 5 + pressAge * 2,
      hexToRgba(hex, 0.55 + pressAge * 0.35),
      1.6
    );
  }
}

function drawImpactFx(
  ctx: CanvasRenderingContext2D,
  s: HighwaySurface,
  f: HighwayFrame,
  fx: HighwayFx
): void {
  if (s.kind !== "void") return;
  const { laneWidth, noteRadius, hitLineY, nowMs, w, h } = f;

  // Strike accent: the line breathes on the beat and brightens on a hit.
  ctx.globalCompositeOperation = "lighter";
  const accent = 0.05 + 0.07 * f.beatPulse01 + 0.3 * fx.hitFlash;
  ctx.fillStyle = `rgba(190,215,255,${accent.toFixed(4)})`;
  ctx.fillRect(0, hitLineY - 1.5, w, 3);

  // Hit flash — bottom-anchored, not a full-height column. This is what makes a
  // hit land.
  for (const flash of fx.laneFlashes) {
    const t = Math.min(1, (nowMs - flash.t0) / LANE_FLASH_MS);
    const cx = laneCenterX(flash.lane, laneWidth);
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = s.laneFlash[flash.lane] ?? "rgba(255,255,255,0.2)";
    ctx.fillRect(flash.lane * laneWidth, hitLineY - 70, laneWidth, 80);
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.fillStyle = hexToRgba(voidHex(flash.lane), 1);
    ctx.fillRect(cx - laneWidth * 0.42, hitLineY - 13, laneWidth * 0.84, 26);
    ctx.globalAlpha = (1 - t) * 0.12;
    ctx.fillStyle = "rgba(220,235,255,1)";
    ctx.fillRect(0, hitLineY - 2, w, 4);
  }
  ctx.globalAlpha = 1;

  // Velocity-aligned streaks. Square debris read as artefacts on black.
  for (const p of fx.particles) {
    const age = nowMs - p.t0;
    const t = age / p.lifeMs;
    const x = p.x + p.vx * age * 0.12;
    const y = p.y + p.vy * age * 0.12 + t * t * 14;
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    ctx.globalAlpha = (1 - t) ** 1.5;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, 1.6, 1.6 + speed * 2.2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  for (const hit of fx.hitEffects) {
    const t = (nowMs - hit.t0) / HIT_FX_MS;
    if (t >= 1) continue;
    const cx = laneCenterX(hit.lane, laneWidth);
    const col = JUDGEMENT_RING_COLOR[hit.judgement] ?? "#fff";
    const e = easeOutCubic(t);
    ctx.globalAlpha = (1 - t) * (hit.judgement === "perfect" ? 0.72 : 0.56);
    ringStroke(
      ctx,
      cx,
      hitLineY,
      noteRadius + 2 + e * HIT_RING_EXPANSION,
      col,
      Math.max(0.9, 2.0 - 1.1 * e)
    );
    const t2 = Math.max(0, t - 0.1) / 0.9;
    ctx.globalAlpha = (1 - t2) * 0.3;
    ringStroke(
      ctx,
      cx,
      hitLineY,
      noteRadius + 1 + easeOutCubic(t2) * (HIT_RING_EXPANSION * 0.45),
      col,
      1.1
    );
    if (hit.judgement === "perfect" && t < 0.35) {
      const ti = t / 0.35;
      ctx.globalAlpha = (1 - ti) * 0.55;
      ringStroke(ctx, cx, hitLineY, noteRadius + 1 + (1 - ti) * 4, "#ffffff", 1.2);
    }
  }
  ctx.globalAlpha = 1;

  // Judgement text, sized to the lane and abbreviated when the window is narrow.
  const fontPx = judgementFontPx(laneWidth);
  const abbreviate = w < 200;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontPx.toFixed(1)}px system-ui`;
  const baseY = hitLineY - (noteRadius + 7);
  for (const txt of fx.judgementTexts) {
    const p = Math.min(1, (nowMs - txt.t0) / JUDGEMENT_TEXT_MS);
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = JUDGEMENT_TEXT_COLOR[txt.judgement] ?? "#fff";
    const label = abbreviate ? judgementLabelShort(txt.judgement) : judgementLabel(txt.judgement);
    ctx.fillText(label, clampTextX(laneCenterX(txt.lane, laneWidth), w), baseY - p * 16);
  }
  ctx.globalAlpha = 1;

  const pulse = fx.edgePulse;
  if (pulse) {
    const age = nowMs - pulse.t0;
    if (age >= 0 && age <= EDGE_PULSE_MS) {
      const lane = pulse.color.length > 0 ? laneIndexForHex(pulse.color) : 0;
      ctx.globalAlpha = (1 - age / EDGE_PULSE_MS) * 0.36;
      ctx.fillStyle = s.edgeVignette[lane] ?? s.edgeVignette[0] ?? "rgba(0,0,0,0)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * The edge pulse carries a colour string rather than a lane index (it predates
 * themes). Map it back so the cached, lane-tinted gradient can be used instead of
 * building one per frame.
 */
function laneIndexForHex(hex: string): number {
  for (let i = 0; i < LANE_COUNT; i++) {
    if (LANE_HEX[i] === hex) return i;
  }
  return 0;
}

function snapHalf(y: number): number {
  return Math.round(y * 2) / 2;
}

/** Centre-anchored sprite blit. `sizeCss` is the sprite's CSS-px side length. */
function blitSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  cx: number,
  cy: number,
  sizeCss: number,
  scale: number
): void {
  const d = sizeCss * scale;
  ctx.drawImage(sprite, cx - d / 2, cy - d / 2, d, d);
}

export const voidTheme: HighwayTheme = Object.freeze({
  id: "void",
  clearColor: "#04040A",
  laneHex: voidHex,
  feel: Object.freeze({
    screenShake: true,
    particleCount: PARTICLES_PER_HIT_VOID,
    particleUpwardCone: true,
  }),
  buildSurface,
  drawBackdropFx,
  drawNotes,
  drawOverlay,
  drawReceptors,
  drawImpactFx,
  judgementRingColor: (j: Judgement): string => JUDGEMENT_RING_COLOR[j] ?? "#fff",
  judgementTextColor: (j: Judgement): string => JUDGEMENT_TEXT_COLOR[j] ?? "#fff",
});
