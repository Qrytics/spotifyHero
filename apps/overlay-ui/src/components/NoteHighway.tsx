import React, { useRef, useEffect } from "react";
import type { Judgement, Note } from "@spotifyhero/shared-types";
import {
  CHART_LEAD_IN_MS,
  noteHeadTimeMs,
  noteTailTimeMs,
} from "@spotifyhero/gameplay-core";
import { useGameStore } from "../store/gameStore.js";
import { playbackClock } from "../lib/playbackClock.js";

/**
 * Canvas 2D highway — hot path avoids allocations, map/filter/sort per frame.
 * Playhead uses `playbackClock` — smooth extrapolation; Spotify polls only re-anchor on meaningful drift.
 */
const LANE_HEX = ["#e040fb", "#1db954", "#ff9800", "#2196f3"];
const LANE_COUNT = 4;
const NOTE_RADIUS = 15;
/** Bottom of static target rings (largest arc in paintStatic). */
const HIT_TARGET_OUTER_R = NOTE_RADIUS + 5;
/** Pixels between canvas bottom and bottom of target rings — “almost touching”. */
const HIT_LINE_BOTTOM_PAD = 4;
const LOOK_BACK_MS = 400;
/** Time span from hit line to top edge (y=0); scroll speed is hitLineY / LOOK_AHEAD_MS px/ms. */
const LOOK_AHEAD_MS = 2200;

/** Vertical center of hit line / receptors — bottom of outer target ring sits `HIT_LINE_BOTTOM_PAD` px above canvas bottom. */
function hitLineYFromHeight(height: number): number {
  return height - HIT_TARGET_OUTER_R - HIT_LINE_BOTTOM_PAD;
}
/**
 * Include notes farther in the future so they render above the canvas top and scroll into view.
 * Without this, the first frame for a note has cy === 0 (pop at top edge).
 */
const SCROLL_IN_ABOVE_MS = 380;
/**
 * Extra lookahead so a forward jump in playhead (drift re-anchor after ~135ms threshold, seek,
 * or a long rAF gap) does not move an off-screen note into visible space in one step.
 */
const SCROLL_IN_STUTTER_MS = 400;
const SCROLL_IN_EXTRA_MS = SCROLL_IN_ABOVE_MS + SCROLL_IN_STUTTER_MS;

const PLAYABLE_PHASES = new Set(["autoplay", "manual", "paused"]);

const HIT_FX_MS = 480;
const HIT_RING_EXPANSION = 56;
/** Past this Y (CSS px) the note is considered off-screen downward. */
const OFF_SCREEN_BOTTOM_PAD = 24;
/** Only clear hold strips after musical tail + buffer (never geometry-only — that hid active sustains). */
const HOLD_STRIP_GHOST_SWEEP_MS = 520;
/** Small temporal epsilon to avoid precision edge-cases around sustain tails. */
const TIME_EPSILON_MS = 0.01;

type HitFx = { lane: number; judgement: Judgement; t0: number };

/** Canvas note visibility — updated from score events (same closure as highway loop). */
type NoteVisibility = {
  /** Tap hidden immediately after a good-timing hit. */
  goneTap: Set<number>;
  /** Hold visuals tracked by absolute playback times (indexed by note id). */
  activeSustains: Map<number, SustainVisual>;
  /** Miss / bad: keep drawing until the gem slides past the bottom edge. */
  missSlide: Set<number>;
};

type SustainVisual = {
  id: number;
  startTime: number;
  endTime: number;
  headHidden: boolean;
};

function judgementFxColor(j: Judgement): string {
  switch (j) {
    case "perfect":
      return "#f5fff9";
    case "great":
      return "#1ed760";
    case "good":
      return "#ffb74d";
    case "bad":
      return "#ff6e8b";
    case "miss":
      return "#ff5252";
    default:
      return "#fff";
  }
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** First index with notes[i].timeMs >= t (notes sorted by timeMs ascending). */
function lowerBoundTime(notes: readonly Note[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid]!.timeMs < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function NoteHighway(): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chart = useGameStore((s) => s.chart);
  const rafRef = useRef<number>(0);
  const dimsRef = useRef({ cssW: -1, cssH: -1 });
  const staticRef = useRef<{ key: string; off: HTMLCanvasElement } | null>(null);
  const sortedNotesRef = useRef<readonly Note[]>([]);

  useEffect(() => {
    if (!chart?.notes) {
      sortedNotesRef.current = [];
      return;
    }
    const raw = chart.notes;
    if (raw.length <= 1) {
      sortedNotesRef.current = raw;
      return;
    }
    let sorted = true;
    for (let i = 1; i < raw.length; i++) {
      if (raw[i]!.timeMs < raw[i - 1]!.timeMs) {
        sorted = false;
        break;
      }
    }
    sortedNotesRef.current = sorted ? raw : [...raw].sort((a, b) => a.timeMs - b.timeMs);
  }, [chart]);

  useEffect(() => {
    if (!chart) return;

    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    const hitEffects: HitFx[] = [];
    let lastEventSig = "";

    const visibility: NoteVisibility = {
      goneTap: new Set(),
      activeSustains: new Map(),
      missSlide: new Set(),
    };

    const unsubHits = useGameStore.subscribe((state) => {
      const ev = state.lastScoreEvent;
      const ch = state.chart;
      if (!ev || !ch?.notes[ev.noteIndex]) return;
      const sig = `${ev.noteIndex}:${ev.judgement}:${ev.pointsAwarded}:${ev.combo}:${ev.deltaMs}:${ev.showHitFx ?? ""}:${ev.countsTowardAccuracy ?? ""}`;
      if (sig === lastEventSig) return;
      lastEventSig = sig;
      const note = ch.notes[ev.noteIndex]!;
      const lane = note.lane;

      /** Sustain interior/tail ticks omit accuracy; only the tail tick sets `showHitFx: true`. */
      const isHoldSustainSuccessTick =
        note.durationMs > 0 &&
        ev.countsTowardAccuracy === false &&
        (ev.judgement === "perfect" ||
          ev.judgement === "great" ||
          ev.judgement === "good");

      const allowHitBurst = isHoldSustainSuccessTick
        ? ev.showHitFx === true
        : ev.showHitFx !== false;

      if (allowHitBurst) {
        hitEffects.push({ lane, judgement: ev.judgement, t0: performance.now() });
        if (hitEffects.length > 14) hitEffects.splice(0, hitEffects.length - 14);
      }
      const idx = ev.noteIndex;
      const good =
        ev.judgement === "perfect" ||
        ev.judgement === "great" ||
        ev.judgement === "good";
      const failed = ev.judgement === "miss" || ev.judgement === "bad";

      if (failed) {
        visibility.goneTap.delete(idx);
        visibility.activeSustains.delete(idx);
        visibility.missSlide.add(idx);
        return;
      }
      if (!good) return;

      if (note.durationMs <= 0) {
        visibility.goneTap.add(idx);
        visibility.missSlide.delete(idx);
        return;
      }
      const startTime = noteHeadTimeMs(note, CHART_LEAD_IN_MS);
      const endTime = noteTailTimeMs(note, CHART_LEAD_IN_MS);
      const existing = visibility.activeSustains.get(idx);
      visibility.activeSustains.set(idx, {
        id: idx,
        startTime: existing?.startTime ?? startTime,
        endTime,
        headHidden: existing?.headHidden ?? false,
      });
      // Sustain ticks (interior + tail): each tick has a unique `sig` via `deltaMs`.
      if (isHoldSustainSuccessTick) {
        visibility.missSlide.delete(idx);
        return;
      }
      // Hold head
      visibility.activeSustains.set(idx, {
        id: idx,
        startTime,
        endTime,
        headHidden: true,
      });
      visibility.missSlide.delete(idx);
    });

    const rebuildStatic = (
      logicalW: number,
      logicalH: number,
      pxW: number,
      pxH: number,
      dpr: number,
      trackId: string
    ): HTMLCanvasElement => {
      const key = `${Math.round(logicalW)}x${Math.round(logicalH)}-${trackId}`;
      const prev = staticRef.current;
      if (prev?.key === key && prev.off.width === pxW && prev.off.height === pxH) {
        return prev.off;
      }

      const off = document.createElement("canvas");
      off.width = pxW;
      off.height = pxH;
      const octx = off.getContext("2d");
      if (!octx) return off;

      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintStatic(octx, logicalW, logicalH);
      staticRef.current = { key, off };
      return off;
    };

    const resizeIfNeeded = (): { dpr: number; lw: number; lh: number } | null => {
      const cssW = Math.max(2, wrap.clientWidth);
      const cssH = Math.max(2, wrap.clientHeight);
      const { cssW: ow, cssH: oh } = dimsRef.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (cssW !== ow || cssH !== oh) {
        dimsRef.current = { cssW, cssH };
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        staticRef.current = null;
      }

      const lw = canvas.width / dpr;
      const lh = canvas.height / dpr;
      return { dpr, lw, lh };
    };

    const loop = (): void => {
      rafRef.current = requestAnimationFrame(loop);

      const state = useGameStore.getState();
      if (
        state.trackLifecycle === "ending" ||
        state.trackLifecycle === "loading" ||
        state.trackLifecycle === "generating"
      ) {
        visibility.goneTap.clear();
        visibility.activeSustains.clear();
        visibility.missSlide.clear();
        return;
      }
      if (!PLAYABLE_PHASES.has(state.phase)) return;
      const c = state.chart;
      if (!c) return;

      const dim = resizeIfNeeded();
      if (!dim || dim.lw < 2 || dim.lh < 2) return;

      const { dpr, lw, lh } = dim;
      const pos = playbackClock.estimateMs();

      const off = rebuildStatic(lw, lh, canvas.width, canvas.height, dpr, c.trackId);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#06060c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(off, 0, 0);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const spd = Math.min(
        5,
        Math.max(0.45, state.settings.noteScrollSpeed ?? 1)
      );
      const lookAheadEffective = LOOK_AHEAD_MS / spd;
      paintNotes(
        ctx,
        sortedNotesRef.current,
        pos,
        lw,
        lh,
        visibility,
        lookAheadEffective
      );
      paintHitEffects(ctx, lw, lh, hitEffects, performance.now());
    };

    dimsRef.current = { cssW: -1, cssH: -1 };
    resizeIfNeeded();
    rafRef.current = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      staticRef.current = null;
    });
    ro.observe(wrap);

    return () => {
      unsubHits();
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      staticRef.current = null;
      dimsRef.current = { cssW: -1, cssH: -1 };
      hitEffects.length = 0;
      lastEventSig = "";
      visibility.goneTap.clear();
      visibility.activeSustains.clear();
      visibility.missSlide.clear();
    };
  }, [chart]);

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        width: "100%",
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}

function paintStatic(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const laneWidth = width / LANE_COUNT;
  const hitLineY = hitLineYFromHeight(height);

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0e0e18");
  grad.addColorStop(1, "#050508");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < LANE_COUNT; i++) {
    const x = i * laneWidth;
    ctx.fillStyle = hexWithAlphaStatic(LANE_HEX[i] ?? "#fff", 0.09);
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
    const cx = i * laneWidth + laneWidth / 2;
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    ctx.arc(cx, hitLineY, NOTE_RADIUS + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = LANE_HEX[i] ?? "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, NOTE_RADIUS + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Static layer only — not per-frame. */
function hexWithAlphaStatic(hex: string, alpha: number): string {
  const n = hex.replace("#", "");
  const full =
    n.length === 3 ? n.split("").map((c) => c + c).join("") : n.padEnd(6, "0").slice(0, 6);
  const v = parseInt(full, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Visible window via binary search + forward scan — no map/filter/sort allocations.
 */
function paintNotes(
  ctx: CanvasRenderingContext2D,
  notes: readonly Note[],
  positionMs: number,
  width: number,
  height: number,
  vis: NoteVisibility,
  lookAheadMs: number
): void {
  const n = notes.length;
  if (n === 0) return;

  const laneWidth = width / LANE_COUNT;
  const hitLineY = hitLineYFromHeight(height);
  const pxPerMs = hitLineY / lookAheadMs;

  const tLow = positionMs - LOOK_BACK_MS;
  const tHigh = positionMs + lookAheadMs + SCROLL_IN_EXTRA_MS;
  const L = CHART_LEAD_IN_MS;
  let i = lowerBoundTime(notes, tLow - L);
  while (i > 0) {
    const prev = notes[i - 1]!;
    const prevEnd = noteTailTimeMs(prev, L);
    if (prevEnd >= tLow) i -= 1;
    else break;
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.42)";

  for (; i < n; i++) {
    const note = notes[i]!;
    if (vis.goneTap.has(i)) continue;
    if (vis.missSlide.has(i)) continue;

    const headT = noteHeadTimeMs(note, L);
    const endMs = noteTailTimeMs(note, L);

    if (headT > tHigh + TIME_EPSILON_MS) break;

    if (endMs < tLow - TIME_EPSILON_MS) continue;

    const timeUntil = headT - positionMs;
    const lane = note.lane;
    const cx = lane * laneWidth + laneWidth / 2;
    const cy = yFromTime(hitLineY, pxPerMs, headT, positionMs);
    const hex = LANE_HEX[lane] ?? "#ffffff";
    const pulse = timeUntil > 900 || timeUntil < -900 ? 0 : 1 - Math.abs(timeUntil) / 900;
    const glowR = NOTE_RADIUS + 5 + pulse * 3;
    const sustain = vis.activeSustains.get(i);
    const holdStripOnly = note.durationMs > 0 && sustain?.headHidden === true;

    if (note.durationMs > 0) {
      const cyTail = yFromTime(hitLineY, pxPerMs, endMs, positionMs);
      const top = Math.min(cy, cyTail);
      const h = Math.abs(cyTail - cy);
      const bodyW = NOTE_RADIUS * 2.35;
      ctx.globalAlpha = holdStripOnly ? 0.48 : 0.42;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.roundRect(cx - bodyW / 2, top, bodyW, Math.max(h, 4), 7);
      ctx.fill();
      ctx.globalAlpha = holdStripOnly ? 0.72 : 0.65;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx - bodyW / 2, top, bodyW, Math.max(h, 4), 7);
      ctx.stroke();
    }

    if (!holdStripOnly) {
      ctx.globalAlpha = 0.14 + pulse * 0.1;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, NOTE_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.42)";
      ctx.beginPath();
      ctx.arc(cx, cy, NOTE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;

  for (const [idx, sustain] of [...vis.activeSustains.entries()]) {
    const note = notes[idx];
    if (!note || note.durationMs <= 0) {
      vis.activeSustains.delete(idx);
      continue;
    }
    if (positionMs >= sustain.endTime + HOLD_STRIP_GHOST_SWEEP_MS - TIME_EPSILON_MS) {
      vis.activeSustains.delete(idx);
    }
  }

  paintSustainDebugOverlay(ctx, vis.activeSustains, positionMs, width);

  paintMissSlidingNotes(
    ctx,
    notes,
    positionMs,
    width,
    height,
    vis.missSlide,
    lookAheadMs
  );
}

/** Missed / bad notes: keep scrolling until past the bottom edge, then drop from the set. */
function paintMissSlidingNotes(
  ctx: CanvasRenderingContext2D,
  notes: readonly Note[],
  positionMs: number,
  width: number,
  height: number,
  missSlide: Set<number>,
  lookAheadMs: number
): void {
  if (missSlide.size === 0) return;

  const laneWidth = width / LANE_COUNT;
  const hitLineY = hitLineYFromHeight(height);
  const pxPerMs = hitLineY / lookAheadMs;
  const toRemove: number[] = [];

  for (const idx of missSlide) {
    const note = notes[idx];
    if (!note) {
      toRemove.push(idx);
      continue;
    }

    const headT = noteHeadTimeMs(note, CHART_LEAD_IN_MS);
    const endMs = noteTailTimeMs(note, CHART_LEAD_IN_MS);
    const lane = note.lane;
    const cx = lane * laneWidth + laneWidth / 2;
    const cy = yFromTime(hitLineY, pxPerMs, headT, positionMs);
    const cyTail = yFromTime(hitLineY, pxPerMs, endMs, positionMs);
    const bottom = Math.max(cy, cyTail);

    if (bottom > height + OFF_SCREEN_BOTTOM_PAD) {
      toRemove.push(idx);
      continue;
    }

    const hex = LANE_HEX[lane] ?? "#ffffff";
    const pulse = 0.35;

    if (note.durationMs > 0) {
      const top = Math.min(cy, cyTail);
      const h = Math.abs(cyTail - cy);
      const bodyW = NOTE_RADIUS * 2.35;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.roundRect(cx - bodyW / 2, top, bodyW, Math.max(h, 4), 7);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(255,82,82,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx - bodyW / 2, top, bodyW, Math.max(h, 4), 7);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.22 + pulse * 0.08;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(cx, cy, NOTE_RADIUS + 5 + pulse * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.72;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(cx, cy, NOTE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,82,82,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, NOTE_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const idx of toRemove) {
    missSlide.delete(idx);
  }

  ctx.globalAlpha = 1;
}

function yFromTime(
  hitLineY: number,
  pxPerMs: number,
  noteTimeMs: number,
  positionMs: number
): number {
  const dt = noteTimeMs - positionMs;
  return hitLineY - dt * pxPerMs;
}

function paintSustainDebugOverlay(
  ctx: CanvasRenderingContext2D,
  activeSustains: Map<number, SustainVisual>,
  positionMs: number,
  width: number
): void {
  if (activeSustains.size === 0) return;
  const rows = [...activeSustains.values()]
    .sort((a, b) => a.endTime - b.endTime)
    .slice(0, 10)
    .map(
      (s) =>
        `S#${s.id}  t=${positionMs.toFixed(0)}  start=${s.startTime.toFixed(0)}  end=${s.endTime.toFixed(0)}  rem=${(s.endTime - positionMs).toFixed(0)}`
    );
  const lineH = 14;
  const pad = 8;
  const boxH = pad * 2 + lineH * (rows.length + 1);
  const boxW = Math.min(width - 16, 360);
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(8, 8, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#baffcf";
  ctx.font = "12px monospace";
  ctx.fillText(`Active sustains: ${activeSustains.size}`, 14, 8 + pad + lineH - 2);
  for (let i = 0; i < rows.length; i++) {
    ctx.fillStyle = "#e8f6ff";
    ctx.fillText(rows[i]!, 14, 8 + pad + (i + 2) * lineH - 2);
  }
  ctx.restore();
}

function paintHitEffects(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effects: HitFx[],
  now: number
): void {
  const laneWidth = width / LANE_COUNT;
  const hitLineY = hitLineYFromHeight(height);

  for (let i = effects.length - 1; i >= 0; i--) {
    if (now - effects[i]!.t0 > HIT_FX_MS) effects.splice(i, 1);
  }

  for (const fx of effects) {
    const elapsed = now - fx.t0;
    const t = elapsed / HIT_FX_MS;
    if (t >= 1) continue;

    const cx = fx.lane * laneWidth + laneWidth / 2;
    const cy = hitLineY;
    const col = judgementFxColor(fx.judgement);
    const e = easeOutCubic(t);

    // Brief bright bloom (perfect / great pop harder)
    if (t < 0.22) {
      const bloom = 1 - t / 0.22;
      const br =
        fx.judgement === "perfect"
          ? NOTE_RADIUS + 22 * bloom
          : NOTE_RADIUS + 14 * bloom;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, br);
      g.addColorStop(0, hexToRgba(col, 0.55 * bloom));
      g.addColorStop(0.45, hexToRgba(col, 0.12 * bloom));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // Expanding rings (impact)
    const rOuter = NOTE_RADIUS + 8 + e * HIT_RING_EXPANSION;
    const alphaRing = (1 - t) * (fx.judgement === "perfect" ? 0.95 : 0.72);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.2, 3.2 - 2.1 * e);
    ctx.globalAlpha = alphaRing;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.stroke();

    const t2 = Math.max(0, t - 0.1) / 0.9;
    const e2 = easeOutCubic(t2);
    const rMid = NOTE_RADIUS + 4 + e2 * (HIT_RING_EXPANSION * 0.65);
    ctx.globalAlpha = (1 - t2) * 0.45;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rMid, 0, Math.PI * 2);
    ctx.stroke();

    // Inner tick ring — crisp on perfect
    if (fx.judgement === "perfect" && t < 0.35) {
      const ti = t / 0.35;
      const rTick = NOTE_RADIUS + 3 + (1 - ti) * 10;
      ctx.globalAlpha = (1 - ti) * 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rTick, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }
}

/** #rrggbb + alpha → rgba() for gradients */
function hexToRgba(hex: string, a: number): string {
  const n = hex.replace("#", "");
  const full =
    n.length === 3 ? n.split("").map((c) => c + c).join("") : n.padEnd(6, "0").slice(0, 6);
  const v = parseInt(full, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r},${g},${b},${a})`;
}
