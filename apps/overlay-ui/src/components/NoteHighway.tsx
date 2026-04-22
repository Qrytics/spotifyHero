import React, { useRef, useEffect } from "react";
import type { Chart, Judgement, Note, ScoreEvent } from "@spotifyhero/shared-types";
import {
  CHART_LEAD_IN_MS,
  noteHeadTimeMs,
  noteTailTimeMs,
} from "@spotifyhero/gameplay-core";
import { useGameStore } from "../store/gameStore.js";
import { calibratedPlaybackMs } from "../lib/playbackPosition.js";
import { shouldHideNotesForQuietPlayback } from "../lib/playbackVolumeGate.js";

/**
 * Canvas 2D highway — hot path avoids allocations, map/filter/sort per frame.
 * Playhead uses `playbackClock` — smooth extrapolation; Spotify polls only re-anchor on meaningful drift.
 */
const LANE_HEX = ["#BF5FFF", "#00E5FF", "#FF6B35", "#39FF14"];
const LANE_COUNT = 4;
const DEFAULT_NOTE_RADIUS = 15;
/** Bottom of static target rings (largest arc in paintStatic). */
/** Pixels between canvas bottom and bottom of target rings — “almost touching”. */
const HIT_LINE_BOTTOM_PAD = 4;
const LOOK_BACK_MS = 400;
/** Time span from hit line to top edge (y=0); scroll speed is hitLineY / LOOK_AHEAD_MS px/ms. */
const LOOK_AHEAD_MS = 2200;

function noteRadiusFromViewport(width: number, height: number): number {
  const laneWidth = width / LANE_COUNT;
  void height;
  const byLane = laneWidth * 0.18;
  return Math.min(30, Math.max(12, byLane));
}

/** Vertical center of hit line / receptors — bottom of outer target ring sits `HIT_LINE_BOTTOM_PAD` px above canvas bottom. */
function hitLineYFromHeight(height: number, noteRadius: number): number {
  return height - (noteRadius + 5) - HIT_LINE_BOTTOM_PAD;
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

/** Reused when chart has no notes — avoids allocating a new Set each frame. */
const EMPTY_OCCLUDED: ReadonlySet<number> = new Set();

const HIT_FX_MS = 480;
const HIT_RING_EXPANSION = 14;
/** Past this Y (CSS px) the note is considered off-screen downward. */
const OFF_SCREEN_BOTTOM_PAD = 24;
/** Small temporal epsilon to avoid precision edge-cases around sustain tails. */
const TIME_EPSILON_MS = 0.01;
/** Large backward playhead jump likely means seek/replay; clear visual state. */
const VISUAL_RESET_BACKWARD_JUMP_MS = 3000;

/** Draw order is time-sorted; score events and visibility use chart `notes` indices — keep both. */
type SortedNote = { note: Note; chartIndex: number };

type HitFx = { lane: number; judgement: Judgement; t0: number };
type LaneFlashFx = { lane: number; t0: number };
type JudgementTextFx = { lane: number; text: string; color: string; t0: number };
type ParticleFx = { lane: number; x: number; y: number; vx: number; vy: number; t0: number; lifeMs: number; color: string };
type ReceptorPopFx = { t0: number };
type EdgePulseFx = { color: string; t0: number };

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
  completed: boolean;
};

type ReceptorPressState = {
  isDown: boolean;
  downAt: number;
  upAt: number;
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

function judgementLabel(j: Judgement): string {
  switch (j) {
    case "perfect":
      return "PERFECT";
    case "great":
      return "GREAT";
    case "good":
      return "GOOD";
    case "bad":
      return "BAD";
    case "miss":
      return "MISS";
    default:
      return "HIT";
  }
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** First index with sortedNotes[i].note.timeMs >= t (sorted by timeMs ascending). */
function lowerBoundSortedTime(sortedNotes: readonly SortedNote[], t: number): number {
  let lo = 0;
  let hi = sortedNotes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedNotes[mid]!.note.timeMs < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Notes that should not draw a highway gem because another sustain on the lane already covers
 * that time: (1) head strictly inside another sustain's (head, tail), (2) tap whose head matches
 * another sustain's tail (next onset — avoids double tail cap + gem).
 */
function occludedInsideSustain(
  sortedNotes: readonly SortedNote[],
  leadInMs: number
): Set<number> {
  const out = new Set<number>();
  const eps = TIME_EPSILON_MS;

  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const sustains: { chartIndex: number; head: number; tail: number }[] = [];
    for (let k = 0; k < sortedNotes.length; k++) {
      const { note, chartIndex } = sortedNotes[k]!;
      if (note.lane !== lane) continue;
      if (note.durationMs <= eps) continue;
      const h = noteHeadTimeMs(note, leadInMs);
      const t = noteTailTimeMs(note, leadInMs);
      if (t <= h + eps) continue;
      sustains.push({ chartIndex, head: h, tail: t });
    }
    sustains.sort((a, b) => a.head - b.head || a.tail - b.tail);

    for (let k = 0; k < sortedNotes.length; k++) {
      const { note, chartIndex } = sortedNotes[k]!;
      if (note.lane !== lane) continue;
      const h = noteHeadTimeMs(note, leadInMs);
      for (const s of sustains) {
        if (s.chartIndex === chartIndex) continue;
        if (h > s.head + eps && h < s.tail - eps) {
          out.add(chartIndex);
          break;
        }
        const tailSlop = Math.max(eps, 0.5);
        if (
          note.durationMs <= eps &&
          Math.abs(h - s.tail) <= tailSlop
        ) {
          out.add(chartIndex);
          break;
        }
      }
    }
  }

  return out;
}

/**
 * Sustain body: stadium / pill — rounded caps at both ends.
 * `cyHead` should be the **outer** head end (past gem center) so the cap overlaps the head gem ring.
 */
function paintSustainBodyPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cyHead: number,
  cyTail: number,
  bodyW: number,
  radii: readonly [number, number, number, number]
): void {
  const top = Math.min(cyHead, cyTail);
  const bot = Math.max(cyHead, cyTail);
  const h = bot - top;
  if (h <= 0.5) return;
  const x = cx - bodyW / 2;
  ctx.beginPath();
  ctx.roundRect(x, top, bodyW, h, radii);
}

/** Sustain strip stays until the tail scrolls past the bottom edge (not a fixed ms after note end). */
function isSustainTailPastCanvasBottom(
  hitLineY: number,
  pxPerMs: number,
  tailTimeMs: number,
  positionMs: number,
  height: number
): boolean {
  const cyTail = yFromTime(hitLineY, pxPerMs, tailTimeMs, positionMs);
  return cyTail > height + OFF_SCREEN_BOTTOM_PAD;
}

const NoteHighwayInner = (): React.ReactElement => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chart = useGameStore((s) => s.chart);
  const rafRef = useRef<number>(0);
  const dimsRef = useRef({ cssW: -1, cssH: -1 });
  const staticRef = useRef<{ key: string; off: HTMLCanvasElement } | null>(null);
  const sortedNotesRef = useRef<readonly SortedNote[]>([]);
  /** Occlusion depends only on chart geometry — recomputed when sorted notes refresh, not every rAF. */
  const occludedRef = useRef<ReadonlySet<number>>(EMPTY_OCCLUDED);

  useEffect(() => {
    if (!chart?.notes) {
      sortedNotesRef.current = [];
      occludedRef.current = EMPTY_OCCLUDED;
      return;
    }
    const raw = chart.notes;
    if (raw.length === 0) {
      sortedNotesRef.current = [];
      occludedRef.current = EMPTY_OCCLUDED;
      return;
    }
    const withIdx = raw.map((note, chartIndex) => ({ note, chartIndex }));
    let sortedNotes: readonly SortedNote[];
    if (raw.length === 1) {
      sortedNotes = withIdx;
    } else {
      let sorted = true;
      for (let i = 1; i < raw.length; i++) {
        if (raw[i]!.timeMs < raw[i - 1]!.timeMs) {
          sorted = false;
          break;
        }
      }
      sortedNotes = sorted
        ? withIdx
        : [...withIdx].sort((a, b) => a.note.timeMs - b.note.timeMs);
    }
    sortedNotesRef.current = sortedNotes;
    occludedRef.current = occludedInsideSustain(sortedNotes, CHART_LEAD_IN_MS);
  }, [chart]);

  useEffect(() => {
    if (!chart) return;

    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    const hitEffects: HitFx[] = [];
    const laneFlashes: LaneFlashFx[] = [];
    const judgementTexts: JudgementTextFx[] = [];
    const particles: ParticleFx[] = [];
    const receptorPop: ReceptorPopFx[] = Array.from({ length: LANE_COUNT }, () => ({ t0: -Infinity }));
    let perfectStreak = 0;
    let edgePulse: EdgePulseFx | null = null;
    const receptorPress: ReceptorPressState[] = Array.from({ length: LANE_COUNT }, () => ({
      isDown: false,
      downAt: -Infinity,
      upAt: -Infinity,
    }));

    const visibility: NoteVisibility = {
      goneTap: new Set(),
      activeSustains: new Map(),
      missSlide: new Set(),
    };
    let lastVisualPosMs: number | null = null;

    const applyOneScoreEvent = (ev: ScoreEvent, ch: Chart): void => {
      if (!ch.notes[ev.noteIndex]) return;
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
      const good =
        ev.judgement === "perfect" ||
        ev.judgement === "great" ||
        ev.judgement === "good";
      const failed = ev.judgement === "miss" || ev.judgement === "bad";

      const spawnHitEffect = (laneFx: number, judgement: Judgement): void => {
        const now = performance.now();
        hitEffects.push({ lane: laneFx, judgement, t0: now });
        if (judgement !== "miss" && judgement !== "bad") {
          laneFlashes.push({ lane: laneFx, t0: now });
        }
        receptorPop[laneFx] = { t0: now };
        judgementTexts.push({
          lane: laneFx,
          text: judgementLabel(judgement),
          color: judgement === "perfect" ? "#FFD54F" : judgement === "good" || judgement === "great" ? "#FFFFFF" : "#FF5252",
          t0: now,
        });
        if (judgementTexts.length > 16) judgementTexts.splice(0, judgementTexts.length - 16);
        const laneWidth = (dimsRef.current.cssW > 0 ? dimsRef.current.cssW : 280) / LANE_COUNT;
        const noteRadius = noteRadiusFromViewport(
          dimsRef.current.cssW > 0 ? dimsRef.current.cssW : 280,
          dimsRef.current.cssH > 0 ? dimsRef.current.cssH : 220
        );
        const cx = laneFx * laneWidth + laneWidth / 2;
        const cy = hitLineYFromHeight(
          dimsRef.current.cssH > 0 ? dimsRef.current.cssH : 220,
          noteRadius
        );
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.25;
          const speed = 0.9 + Math.random() * 1.7;
          particles.push({
            lane: laneFx,
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1.4,
            t0: now,
            lifeMs: 220,
            color: LANE_HEX[laneFx] ?? "#fff",
          });
        }
        if (particles.length > 180) particles.splice(0, particles.length - 180);
      };

      if (allowHitBurst) {
        spawnHitEffect(lane, ev.judgement);
        if (hitEffects.length > 14) hitEffects.splice(0, hitEffects.length - 14);
      }
      const idx = ev.noteIndex;

      if (ev.judgement === "perfect") {
        perfectStreak += 1;
        if (perfectStreak % 10 === 0) {
          edgePulse = { color: LANE_HEX[lane] ?? "#fff", t0: performance.now() };
        }
      } else if (failed) {
        perfectStreak = 0;
      }

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
        completed: existing?.completed ?? false,
      });
      // Sustain ticks (interior + tail): each tick has a unique `sig` via `deltaMs`.
      if (isHoldSustainSuccessTick) {
        // Tail checkpoint marks completion; render removes strip exactly at note end.
        if (ev.showHitFx === true) {
          const current = visibility.activeSustains.get(idx);
          if (current) {
            visibility.activeSustains.set(idx, { ...current, completed: true });
          }
          visibility.goneTap.add(idx);
        }
        visibility.missSlide.delete(idx);
        return;
      }
      // Hold head
      visibility.activeSustains.set(idx, {
        id: idx,
        startTime,
        endTime,
        headHidden: true,
        completed: false,
      });
      visibility.missSlide.delete(idx);
    };

    const unsubHits = useGameStore.subscribe((state, prev) => {
      if (state.scoreEventSeq === prev.scoreEventSeq) return;
      const batch = state.lastScoreEventBatch;
      if (!batch?.length) return;
      const ch = state.chart;
      if (!ch) return;
      for (const ev of batch) {
        applyOneScoreEvent(ev, ch);
      }
    });

    const onLaneDown = (ev: Event): void => {
      const ce = ev as CustomEvent<{ lane: number }>;
      const lane = ce.detail?.lane;
      if (lane === undefined || lane < 0 || lane >= LANE_COUNT) return;
      receptorPress[lane] = {
        ...receptorPress[lane]!,
        isDown: true,
        downAt: performance.now(),
      };
    };
    const onLaneUp = (ev: Event): void => {
      const ce = ev as CustomEvent<{ lane: number }>;
      const lane = ce.detail?.lane;
      if (lane === undefined || lane < 0 || lane >= LANE_COUNT) return;
      receptorPress[lane] = {
        ...receptorPress[lane]!,
        isDown: false,
        upAt: performance.now(),
      };
    };
    window.addEventListener("spotifyhero:lanedown", onLaneDown);
    window.addEventListener("spotifyhero:laneup", onLaneUp);

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
        if (
          visibility.activeSustains.size > 0 ||
          visibility.goneTap.size > 0 ||
          visibility.missSlide.size > 0
        ) {
        }
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
      const pos = calibratedPlaybackMs() + (state.settings.visualNoteOffsetMs ?? 0);
      if (lastVisualPosMs !== null && pos < lastVisualPosMs - VISUAL_RESET_BACKWARD_JUMP_MS) {
        hitEffects.length = 0;
        laneFlashes.length = 0;
        judgementTexts.length = 0;
        particles.length = 0;
        perfectStreak = 0;
        edgePulse = null;
        visibility.goneTap.clear();
        visibility.activeSustains.clear();
        visibility.missSlide.clear();
      }
      lastVisualPosMs = pos;

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
      const sorted = sortedNotesRef.current;
      const notesToPaint = shouldHideNotesForQuietPlayback(state.playback, state.phase)
        ? []
        : sorted;
      const nowFx = performance.now();
      paintSpeedLines(ctx, lw, lh, nowFx);
      paintNotes(
        ctx,
        notesToPaint,
        c.notes,
        pos,
        lw,
        lh,
        visibility,
        lookAheadEffective,
        occludedRef.current,
        nowFx
      );
      paintLaneFlashes(ctx, lw, lh, laneFlashes, nowFx);
      paintDynamicReceptors(ctx, lw, lh, receptorPop, nowFx);
      paintReceptorPressGlow(ctx, lw, lh, receptorPress, nowFx);
      paintHitEffects(ctx, lw, lh, hitEffects, nowFx);
      paintParticles(ctx, particles, nowFx);
      paintJudgementTexts(ctx, lw, lh, judgementTexts, nowFx);
      paintEdgePulse(ctx, lw, lh, edgePulse, nowFx);
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
      window.removeEventListener("spotifyhero:lanedown", onLaneDown);
      window.removeEventListener("spotifyhero:laneup", onLaneUp);
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      staticRef.current = null;
      dimsRef.current = { cssW: -1, cssH: -1 };
      hitEffects.length = 0;
      laneFlashes.length = 0;
      judgementTexts.length = 0;
      particles.length = 0;
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
        contain: "strict",
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
};

export const NoteHighway = React.memo(NoteHighwayInner);

function paintStatic(ctx: CanvasRenderingContext2D, width: number, height: number): void {
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
    ctx.arc(cx, hitLineY, noteRadius + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = LANE_HEX[i] ?? "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, noteRadius + 2, 0, Math.PI * 2);
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
  sortedNotes: readonly SortedNote[],
  chartNotes: readonly Note[],
  positionMs: number,
  width: number,
  height: number,
  vis: NoteVisibility,
  lookAheadMs: number,
  occluded: ReadonlySet<number>,
  nowMs: number
): void {
  const n = sortedNotes.length;
  if (n === 0) return;

  const L = CHART_LEAD_IN_MS;

  const laneWidth = width / LANE_COUNT;
  const noteRadius = noteRadiusFromViewport(width, height);
  const hitLineY = hitLineYFromHeight(height, noteRadius);
  const pxPerMs = hitLineY / lookAheadMs;

  const tLow = positionMs - LOOK_BACK_MS;
  const tHigh = positionMs + lookAheadMs + SCROLL_IN_EXTRA_MS;
  let i = lowerBoundSortedTime(sortedNotes, tLow - L);
  while (i > 0) {
    const prevSn = sortedNotes[i - 1]!;
    const prev = prevSn.note;
    const prevEnd = noteTailTimeMs(prev, L);
    if (prevEnd >= tLow) {
      i -= 1;
      continue;
    }
    if (
      prev.durationMs > 0 &&
      vis.activeSustains.has(prevSn.chartIndex) &&
      !isSustainTailPastCanvasBottom(hitLineY, pxPerMs, prevEnd, positionMs, height)
    ) {
      i -= 1;
      continue;
    }
    break;
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  const paintedActiveSustains = new Set<number>();

  for (; i < n; i++) {
    const { note, chartIndex } = sortedNotes[i]!;
    if (vis.goneTap.has(chartIndex)) continue;
    if (vis.missSlide.has(chartIndex)) continue;
    if (occluded.has(chartIndex) && !vis.activeSustains.has(chartIndex)) {
      continue;
    }

    const headT = noteHeadTimeMs(note, L);
    const endMs = noteTailTimeMs(note, L);

    if (headT > tHigh + TIME_EPSILON_MS) break;

    if (endMs < tLow - TIME_EPSILON_MS) {
      const activeHold =
        note.durationMs > 0 && vis.activeSustains.has(chartIndex);
      if (
        !activeHold ||
        isSustainTailPastCanvasBottom(hitLineY, pxPerMs, endMs, positionMs, height)
      ) {
        continue;
      }
    }

    const timeUntil = headT - positionMs;
    const lane = note.lane;
    const cx = lane * laneWidth + laneWidth / 2;
    const cy = yFromTime(hitLineY, pxPerMs, headT, positionMs);
    const hex = LANE_HEX[lane] ?? "#ffffff";
    const pulse = timeUntil > 900 || timeUntil < -900 ? 0 : 1 - Math.abs(timeUntil) / 900;
    const glowR = noteRadius + 5 + pulse * 3;
    const sustain = vis.activeSustains.get(chartIndex);
    const holdStripOnly = note.durationMs > 0 && sustain?.headHidden === true;
    if (sustain?.completed && positionMs >= endMs - TIME_EPSILON_MS) {
      vis.activeSustains.delete(chartIndex);
      continue;
    }

    const approach = Math.min(1, Math.max(0.6, 1 - (timeUntil - 80) / Math.max(lookAheadMs, 1)));
    const anticipationT =
      timeUntil > 100 || timeUntil < -60 ? 0 : Math.max(0, 1 - Math.abs(timeUntil) / 100);
    const noteScale = 1 + anticipationT * 0.08;
    const noteR = noteRadius * noteScale;

    if (note.durationMs > 0) {
      const cyTail = yFromTime(hitLineY, pxPerMs, endMs, positionMs);
      const cyHeadBar = holdStripOnly
        ? hitLineY + noteR
        : yFromTime(hitLineY, pxPerMs, headT, positionMs) + noteR;
      const h = Math.abs(cyTail - cyHeadBar);
      if (sustain && h > 0.75) {
        paintedActiveSustains.add(chartIndex);
      }
      if (h <= 0.75) {
        if (sustain?.completed || positionMs >= endMs - TIME_EPSILON_MS) {
          vis.goneTap.add(chartIndex);
          vis.activeSustains.delete(chartIndex);
        }
        continue;
      }
      const bodyW = noteR * 2.35;
      const rCap = Math.min(bodyW * 0.5, h * 0.5);
      const cornerRadii = [rCap, rCap, rCap, rCap] as const;
      const shimmer = (Math.sin(nowMs * 0.012 + chartIndex) + 1) * 0.5;
      ctx.globalAlpha = holdStripOnly ? 0.88 : 0.84;
      ctx.fillStyle = hex;
      ctx.shadowColor = hexToRgba(hex, 0.55);
      ctx.shadowBlur = 8 + shimmer * 6;
      paintSustainBodyPath(ctx, cx, cyHeadBar, cyTail, bodyW, cornerRadii);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = holdStripOnly ? 0.95 : 0.9;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      paintSustainBodyPath(ctx, cx, cyHeadBar, cyTail, bodyW, cornerRadii);
      ctx.stroke();

    }

    if (!holdStripOnly) {
      ctx.globalAlpha = (0.14 + pulse * 0.1) * approach;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR * noteScale, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = approach;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, noteR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.42)";
      ctx.beginPath();
      ctx.arc(cx, cy, noteR, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;

  for (const [idx, sustain] of vis.activeSustains) {
    const note = chartNotes[idx];
    if (!note || note.durationMs <= 0) {
      vis.goneTap.add(idx);
      vis.activeSustains.delete(idx);
      continue;
    }
    if (
      isSustainTailPastCanvasBottom(
        hitLineY,
        pxPerMs,
        sustain.endTime,
        positionMs,
        height
      )
    ) {
      vis.goneTap.add(idx);
      vis.activeSustains.delete(idx);
    }
  }

  for (const [idx, sustain] of vis.activeSustains) {
    if (paintedActiveSustains.has(idx)) continue;
    const note = chartNotes[idx];
    if (!note || note.durationMs <= 0) continue;
    if (vis.goneTap.has(idx) || vis.missSlide.has(idx)) continue;
    const headT = noteHeadTimeMs(note, L);
    const endT = noteTailTimeMs(note, L);
    if (
      isSustainTailPastCanvasBottom(hitLineY, pxPerMs, sustain.endTime, positionMs, height) ||
      positionMs > endT + TIME_EPSILON_MS
    ) {
      continue;
    }
    const lane = note.lane;
    const cx = lane * laneWidth + laneWidth / 2;
    const noteR = noteRadius;
    const holdStripOnly = sustain.headHidden === true;
    const cyTail = yFromTime(hitLineY, pxPerMs, endT, positionMs);
    const cyHeadBar = holdStripOnly
      ? hitLineY + noteR
      : yFromTime(hitLineY, pxPerMs, headT, positionMs) + noteR;
    const h = Math.abs(cyTail - cyHeadBar);
    if (h <= 0.75) {
      continue;
    }
    const hex = LANE_HEX[lane] ?? "#ffffff";
    const bodyW = noteR * 2.35;
    const rCap = Math.min(bodyW * 0.5, h * 0.5);
    const cornerRadii = [rCap, rCap, rCap, rCap] as const;
    const shimmer = (Math.sin(nowMs * 0.012 + idx) + 1) * 0.5;
    ctx.globalAlpha = holdStripOnly ? 0.88 : 0.84;
    ctx.fillStyle = hex;
    ctx.shadowColor = hexToRgba(hex, 0.55);
    ctx.shadowBlur = 8 + shimmer * 6;
    paintSustainBodyPath(ctx, cx, cyHeadBar, cyTail, bodyW, cornerRadii);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = holdStripOnly ? 0.95 : 0.9;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    paintSustainBodyPath(ctx, cx, cyHeadBar, cyTail, bodyW, cornerRadii);
    ctx.stroke();
    paintedActiveSustains.add(idx);
  }

  paintMissSlidingNotes(
    ctx,
    chartNotes,
    positionMs,
    width,
    height,
    vis.missSlide,
    lookAheadMs
  );
}

function paintReceptorPressGlow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  press: readonly ReceptorPressState[],
  now: number
): void {
  const laneWidth = width / LANE_COUNT;
  const noteRadius = noteRadiusFromViewport(width, height);
  const hitLineY = hitLineYFromHeight(height, noteRadius);
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const p = press[lane];
    if (!p) continue;
    const justReleased = !p.isDown && now - p.upAt < 90;
    if (!p.isDown && !justReleased) continue;
    const cx = lane * laneWidth + laneWidth / 2;
    const col = LANE_HEX[lane] ?? "#fff";
    const age = p.isDown ? Math.min(1, (now - p.downAt) / 90) : Math.max(0, 1 - (now - p.upAt) / 90);
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

  const noteRadius = noteRadiusFromViewport(width, height);
  const laneWidth = width / LANE_COUNT;
  const hitLineY = hitLineYFromHeight(height, noteRadius);
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
    const cyHeadBar = note.durationMs > 0 ? cy + noteRadius : cy;
    const bottom = Math.max(cyHeadBar, cyTail);

    if (bottom > height + OFF_SCREEN_BOTTOM_PAD) {
      toRemove.push(idx);
      continue;
    }

    const hex = LANE_HEX[lane] ?? "#ffffff";
    const pulse = 0.35;

    if (note.durationMs > 0) {
      const h = Math.abs(cyTail - cyHeadBar);
      const bodyW = noteRadius * 2.35;
      const rCap = Math.min(bodyW * 0.5, h * 0.5);
      const cornerRadii = [rCap, rCap, rCap, rCap] as const;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = hex;
      paintSustainBodyPath(ctx, cx, cyHeadBar, cyTail, bodyW, cornerRadii);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(255,82,82,0.55)";
      ctx.lineWidth = 2;
      paintSustainBodyPath(ctx, cx, cyHeadBar, cyTail, bodyW, cornerRadii);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.22 + pulse * 0.08;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(cx, cy, noteRadius + 5 + pulse * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.72;
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(cx, cy, noteRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,82,82,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, noteRadius, 0, Math.PI * 2);
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

function paintHitEffects(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effects: HitFx[],
  now: number
): void {
  const laneWidth = width / LANE_COUNT;
  const noteRadius = noteRadiusFromViewport(width, height);
  const hitLineY = hitLineYFromHeight(height, noteRadius);

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

    // Minimal ring pulse (GH-style subtle impact)
    const rOuter = noteRadius + 2 + e * HIT_RING_EXPANSION;
    const alphaRing = (1 - t) * (fx.judgement === "perfect" ? 0.72 : 0.56);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.9, 2.0 - 1.1 * e);
    ctx.globalAlpha = alphaRing;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.stroke();

    const t2 = Math.max(0, t - 0.1) / 0.9;
    const e2 = easeOutCubic(t2);
    const rMid = noteRadius + 1 + e2 * (HIT_RING_EXPANSION * 0.45);
    ctx.globalAlpha = (1 - t2) * 0.3;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, rMid, 0, Math.PI * 2);
    ctx.stroke();

    // Tight inner tick ring — crisp on perfect only
    if (fx.judgement === "perfect" && t < 0.35) {
      const ti = t / 0.35;
      const rTick = noteRadius + 1 + (1 - ti) * 4;
      ctx.globalAlpha = (1 - ti) * 0.55;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, rTick, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }
}

function paintSpeedLines(ctx: CanvasRenderingContext2D, width: number, height: number, now: number): void {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  const offset = (now * 0.18) % 28;
  for (let x = 8; x < width; x += 26) {
    for (let y = -24 + offset; y < height; y += 28) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 12);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintLaneFlashes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  flashes: LaneFlashFx[],
  now: number
): void {
  const laneWidth = width / LANE_COUNT;
  for (let i = flashes.length - 1; i >= 0; i--) {
    const age = now - flashes[i]!.t0;
    if (age > 90) flashes.splice(i, 1);
  }
  for (const fx of flashes) {
    const t = Math.min(1, (now - fx.t0) / 90);
    const alpha = (1 - t) * 0.3;
    ctx.fillStyle = hexToRgba(LANE_HEX[fx.lane] ?? "#fff", alpha);
    ctx.fillRect(fx.lane * laneWidth, 0, laneWidth, height);
  }
}

function paintDynamicReceptors(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pop: ReceptorPopFx[],
  now: number
): void {
  const laneWidth = width / LANE_COUNT;
  const noteRadius = noteRadiusFromViewport(width, height);
  const hitLineY = hitLineYFromHeight(height, noteRadius);
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const age = now - (pop[lane]?.t0 ?? -Infinity);
    const t = age < 120 ? age / 120 : 1;
    const bump = age < 120 ? 1 + Math.sin((1 - t) * Math.PI) * 0.3 : 1;
    const cx = lane * laneWidth + laneWidth / 2;
    const col = LANE_HEX[lane] ?? "#fff";
    ctx.strokeStyle = hexToRgba(col, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, (noteRadius + 2) * bump, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = hexToRgba(col, 0.25);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, hitLineY, (noteRadius + 8) * (1 + Math.sin(now * 0.003 + lane) * 0.03), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function paintJudgementTexts(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  texts: JudgementTextFx[],
  now: number
): void {
  const laneWidth = width / LANE_COUNT;
  const noteRadius = noteRadiusFromViewport(width, height);
  const baseY = hitLineYFromHeight(height, noteRadius) - (noteRadius + 7);
  for (let i = texts.length - 1; i >= 0; i--) {
    const age = now - texts[i]!.t0;
    if (age > 520) texts.splice(i, 1);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 12px system-ui";
  for (const t of texts) {
    const p = Math.min(1, (now - t.t0) / 520);
    const y = baseY - p * 16;
    ctx.globalAlpha = 1 - p;
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.lane * laneWidth + laneWidth / 2, y);
  }
  ctx.globalAlpha = 1;
}

function paintParticles(ctx: CanvasRenderingContext2D, particles: ParticleFx[], now: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    const age = now - p.t0;
    if (age > p.lifeMs) particles.splice(i, 1);
  }
  for (const p of particles) {
    const t = (now - p.t0) / p.lifeMs;
    const x = p.x + p.vx * (now - p.t0) * 0.12;
    const y = p.y + p.vy * (now - p.t0) * 0.12 + t * t * 14;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.color;
    ctx.fillRect(x, y, 2.4, 2.4);
  }
  ctx.globalAlpha = 1;
}

function paintEdgePulse(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pulse: EdgePulseFx | null,
  now: number
): void {
  if (!pulse) return;
  const age = now - pulse.t0;
  if (age > 260) return;
  const t = age / 260;
  const a = (1 - t) * 0.36;
  const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.36, width / 2, height / 2, Math.max(width, height));
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, hexToRgba(pulse.color, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
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
