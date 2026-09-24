import type { Judgement } from "@spotifyhero/shared-types";
import {
  JUDGEMENT_RING_COLOR,
  JUDGEMENT_TEXT_COLOR,
  LANE_HEX_CLASSIC,
  easeOutCubic,
  hexToRgba,
  judgementLabel,
} from "../color.js";
import { HIT_FX_MS, HIT_RING_EXPANSION, LANE_COUNT } from "../highwayConstants.js";
import {
  hitLineYFromHeight,
  laneCenterX,
  noteRadiusFromViewport,
  type HighwayFrame,
} from "../highwayGeometry.js";
import {
  DRAW_GEM,
  DRAW_MISS_GEM,
  DRAW_MISS_SUSTAIN,
  DRAW_SUSTAIN,
  DRAW_SUSTAIN_HELD,
  type DrawList,
} from "../noteDrawList.js";
import {
  EDGE_PULSE_MS,
  JUDGEMENT_TEXT_MS,
  LANE_FLASH_MS,
  type HighwayFx,
} from "../fxState.js";
import { pillPath, pillRadii } from "./primitives.js";
import type { HighwaySurface, HighwayTheme } from "./types.js";

/**
 * Classic — the look shipped at tag `visuals/classic-2026-09-24`, bug-for-bug.
 *
 * Preserved deliberately, because they *are* the look:
 *  - the doubled receptor ring (static and dynamic both stroke `noteRadius + 2`,
 *    so the resting target is a muddied double line);
 *  - the effectively invisible speed lines (0.12 × 0.22 ≈ 2.6% opacity) that
 *    scroll off the wall clock and therefore drift against the notes;
 *  - the wall-clock sustain shimmer (a per-note sine unrelated to the music);
 *  - the sustain width coupled to the anticipation pop, so hold bodies widen ~8%
 *    as they reach the line;
 *  - the per-frame `createRadialGradient` in the press glow and the edge pulse,
 *    and the per-sustain-per-frame `shadowBlur`. The no-gradients-per-frame rule
 *    applies to `void.ts`; this file predates it.
 *  - `700 12px system-ui` judgement text, which overflows a 45px lane.
 *
 * The only things it inherits are shared, non-look changes: the de-duplicated
 * sustain scan in `noteDrawList.ts`, and the combo-milestone edge pulse now firing
 * off the store's `comboMilestoneSeq` instead of a private every-10th-perfect
 * counter that disagreed with the HUD.
 *
 * **Do not "improve" this file.** Its entire job is to be a revert path.
 */

function classicHex(lane: number): string {
  return LANE_HEX_CLASSIC[lane] ?? "#ffffff";
}

function buildSurface(
  _ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number
): HighwaySurface {
  const off = document.createElement("canvas");
  off.width = Math.max(1, Math.floor(w * dpr));
  off.height = Math.max(1, Math.floor(h * dpr));
  const octx = off.getContext("2d");
  if (octx) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintClassicStatic(octx, w, h);
  }
  return { kind: "classic", bg: off, w, h, dpr };
}

function paintClassicStatic(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const noteRadius = noteRadiusFromViewport(width, height);
  const laneWidth = width / LANE_COUNT;
  const hitLineY = hitLineYFromHeight(height, noteRadius);

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0e0e18");
  grad.addColorStop(1, "#050508");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < LANE_COUNT; i++) {
    const x = i * laneWidth;
    ctx.fillStyle = hexToRgba(classicHex(i), 0.09);
    ctx.fillRect(x, 0, laneWidth, height);
  }

  for (let i = 1; i < LANE_COUNT; i++) {
    const x = i * laneWidth;
    ctx.fillStyle = "rgba(74,74,92,0.85)";
    ctx.fillRect(x - 0.5, 0, 1, height);
  }

  ctx.fillStyle = "rgba(29,185,84,0.16)";
  ctx.fillRect(0, hitLineY - 4, width, 8);
  ctx.fillStyle = "rgba(154,154,176,1)";
  ctx.fillRect(0, hitLineY - 1.5, width, 3);

  for (let i = 0; i < LANE_COUNT; i++) {
    const cx = laneCenterX(i, laneWidth);
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    ctx.arc(cx, hitLineY, noteRadius + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = classicHex(i);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, noteRadius + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Wall-clock scroll, unscaled by `noteScrollSpeed` — the drift is the bug being preserved. */
function drawBackdropFx(
  ctx: CanvasRenderingContext2D,
  _s: HighwaySurface,
  f: HighwayFrame
): void {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  const offset = (f.nowMs * 0.18) % 28;
  for (let x = 8; x < f.w; x += 26) {
    for (let y = -24 + offset; y < f.h; y += 28) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * One pass, in list order. Items are emitted in exactly the order the old
 * `paintNotes` drew them, so this reproduces the original z-order — including the
 * quirk where a sustain leaves `lineWidth` at 1.5 for the gem stroke that follows.
 */
function drawNotes(
  ctx: CanvasRenderingContext2D,
  _s: HighwaySurface,
  _f: HighwayFrame,
  list: DrawList
): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.42)";

  for (let i = 0; i < list.length; i++) {
    const it = list.items[i]!;
    const hex = classicHex(it.lane);

    if (it.kind === DRAW_SUSTAIN || it.kind === DRAW_SUSTAIN_HELD) {
      const held = it.kind === DRAW_SUSTAIN_HELD;
      const h = Math.abs(it.cyTail - it.cyHeadBar);
      // `it.radius` (popped) on purpose — this is the width-wobble bug.
      const bodyW = it.radius * 2.35;
      const radii = pillRadii(bodyW, h);
      const shimmer = (Math.sin(_f.nowMs * 0.012 + it.chartIndex) + 1) * 0.5;
      ctx.globalAlpha = held ? 0.88 : 0.84;
      ctx.fillStyle = hex;
      ctx.shadowColor = hexToRgba(hex, 0.55);
      ctx.shadowBlur = 8 + shimmer * 6;
      pillPath(ctx, it.cx, it.cyHeadBar, it.cyTail, bodyW, radii);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = held ? 0.95 : 0.9;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      pillPath(ctx, it.cx, it.cyHeadBar, it.cyTail, bodyW, radii);
      ctx.stroke();
      continue;
    }

    if (it.kind === DRAW_GEM) {
      const noteScale = it.baseRadius > 0 ? it.radius / it.baseRadius : 1;
      const glowR = it.baseRadius + 5 + it.pulse * 3;
      ctx.globalAlpha = (0.14 + it.pulse * 0.1) * it.approach;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, glowR * noteScale, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = it.approach;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.42)";
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.radius, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }

    if (it.kind === DRAW_MISS_SUSTAIN) {
      const h = Math.abs(it.cyTail - it.cyHeadBar);
      const bodyW = it.baseRadius * 2.35;
      const radii = pillRadii(bodyW, h);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = hex;
      pillPath(ctx, it.cx, it.cyHeadBar, it.cyTail, bodyW, radii);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(255,82,82,0.55)";
      ctx.lineWidth = 2;
      pillPath(ctx, it.cx, it.cyHeadBar, it.cyTail, bodyW, radii);
      ctx.stroke();
      continue;
    }

    if (it.kind === DRAW_MISS_GEM) {
      ctx.globalAlpha = 0.22 + it.pulse * 0.08;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.baseRadius + 5 + it.pulse * 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.72;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.baseRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,82,82,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.baseRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
}

/**
 * Classic has no far fade. This slot — after the notes, before the receptors — is
 * where the full-height lane flashes went in the original draw order, so they stay
 * here rather than moving into `drawImpactFx` (which runs after the receptors).
 */
function drawOverlay(
  ctx: CanvasRenderingContext2D,
  _s: HighwaySurface,
  f: HighwayFrame,
  fx: HighwayFx
): void {
  for (const flash of fx.laneFlashes) {
    const t = Math.min(1, (f.nowMs - flash.t0) / LANE_FLASH_MS);
    const alpha = (1 - t) * 0.3;
    ctx.fillStyle = hexToRgba(classicHex(flash.lane), alpha);
    ctx.fillRect(flash.lane * f.laneWidth, 0, f.laneWidth, f.h);
  }
}

function drawReceptors(
  ctx: CanvasRenderingContext2D,
  _s: HighwaySurface,
  f: HighwayFrame,
  fx: HighwayFx
): void {
  const { laneWidth, noteRadius, hitLineY, nowMs } = f;

  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const age = nowMs - (fx.receptorPop[lane]?.t0 ?? -Infinity);
    const t = age < 120 ? age / 120 : 1;
    const bump = age < 120 ? 1 + Math.sin((1 - t) * Math.PI) * 0.3 : 1;
    const cx = laneCenterX(lane, laneWidth);
    const col = classicHex(lane);
    ctx.strokeStyle = hexToRgba(col, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, (noteRadius + 2) * bump, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(col, 0.25);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(
      cx,
      hitLineY,
      (noteRadius + 8) * (1 + Math.sin(nowMs * 0.003 + lane) * 0.03),
      0,
      Math.PI * 2
    );
    ctx.stroke();
  }

  // Per-frame gradient, preserved as-is. See the file header.
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const p = fx.receptorPress[lane];
    if (!p) continue;
    const justReleased = !p.isDown && nowMs - p.upAt < 90;
    if (!p.isDown && !justReleased) continue;
    const cx = laneCenterX(lane, laneWidth);
    const col = classicHex(lane);
    const age = p.isDown
      ? Math.min(1, (nowMs - p.downAt) / 90)
      : Math.max(0, 1 - (nowMs - p.upAt) / 90);
    const r = noteRadius + 7 + age * 2;
    const g = ctx.createRadialGradient(cx, hitLineY, 0, cx, hitLineY, r + 10);
    g.addColorStop(0, hexToRgba(col, 0.3 + age * 0.25));
    g.addColorStop(0.55, hexToRgba(col, 0.13 + age * 0.15));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, r + 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(col, 0.6 + age * 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawImpactFx(
  ctx: CanvasRenderingContext2D,
  _s: HighwaySurface,
  f: HighwayFrame,
  fx: HighwayFx
): void {
  const { laneWidth, noteRadius, hitLineY, nowMs } = f;

  for (const hit of fx.hitEffects) {
    const t = (nowMs - hit.t0) / HIT_FX_MS;
    if (t >= 1) continue;
    const cx = laneCenterX(hit.lane, laneWidth);
    const col = JUDGEMENT_RING_COLOR[hit.judgement] ?? "#fff";
    const e = easeOutCubic(t);

    const rOuter = noteRadius + 2 + e * HIT_RING_EXPANSION;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.9, 2.0 - 1.1 * e);
    ctx.globalAlpha = (1 - t) * (hit.judgement === "perfect" ? 0.72 : 0.56);
    ctx.beginPath();
    ctx.arc(cx, hitLineY, rOuter, 0, Math.PI * 2);
    ctx.stroke();

    const t2 = Math.max(0, t - 0.1) / 0.9;
    const e2 = easeOutCubic(t2);
    const rMid = noteRadius + 1 + e2 * (HIT_RING_EXPANSION * 0.45);
    ctx.globalAlpha = (1 - t2) * 0.3;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, rMid, 0, Math.PI * 2);
    ctx.stroke();

    if (hit.judgement === "perfect" && t < 0.35) {
      const ti = t / 0.35;
      ctx.globalAlpha = (1 - ti) * 0.55;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, hitLineY, noteRadius + 1 + (1 - ti) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  for (const p of fx.particles) {
    const t = (nowMs - p.t0) / p.lifeMs;
    const x = p.x + p.vx * (nowMs - p.t0) * 0.12;
    const y = p.y + p.vy * (nowMs - p.t0) * 0.12 + t * t * 14;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, 2.4, 2.4);
  }
  ctx.globalAlpha = 1;

  const baseY = hitLineY - (noteRadius + 7);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 12px system-ui";
  for (const txt of fx.judgementTexts) {
    const p = Math.min(1, (nowMs - txt.t0) / JUDGEMENT_TEXT_MS);
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = JUDGEMENT_TEXT_COLOR[txt.judgement] ?? "#fff";
    ctx.fillText(judgementLabel(txt.judgement), laneCenterX(txt.lane, laneWidth), baseY - p * 16);
  }
  ctx.globalAlpha = 1;

  const pulse = fx.edgePulse;
  if (pulse) {
    const age = nowMs - pulse.t0;
    if (age <= EDGE_PULSE_MS) {
      const a = (1 - age / EDGE_PULSE_MS) * 0.36;
      const g = ctx.createRadialGradient(
        f.w / 2,
        f.h / 2,
        Math.min(f.w, f.h) * 0.36,
        f.w / 2,
        f.h / 2,
        Math.max(f.w, f.h)
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, hexToRgba(pulse.color, a));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, f.w, f.h);
    }
  }
}

export const classicTheme: HighwayTheme = Object.freeze({
  id: "classic",
  clearColor: "#06060c",
  laneHex: classicHex,
  feel: Object.freeze({
    screenShake: false,
    particleCount: 10,
    particleUpwardCone: false,
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
