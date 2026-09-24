import React, { useRef, useEffect } from "react";
import type { Chart, ScoreEvent } from "@spotifyhero/shared-types";
import { CHART_LEAD_IN_MS, noteHeadTimeMs } from "@spotifyhero/gameplay-core";
import { useGameStore } from "@spotifyhero/game-state";
import { shouldHideNotesForQuietPlayback } from "./playbackVolumeGate.js";
import {
  HIT_FX_MS,
  LANE_COUNT,
  LOOK_AHEAD_MS,
  PLAYABLE_PHASES,
  VISUAL_RESET_BACKWARD_JUMP_MS,
} from "./highwayConstants.js";
import {
  createHighwayFrame,
  hitLineYFromHeight,
  laneCenterX,
  noteRadiusFromViewport,
} from "./highwayGeometry.js";
import {
  EMPTY_OCCLUDED,
  applyScoreEventToVisibility,
  buildSortedNotes,
  clearNoteVisibility,
  createNoteVisibility,
  occludedInsideSustain,
  scoreEventBurstJudgement,
  type SortedNote,
} from "./noteVisibility.js";
import { buildDrawList, createDrawList } from "./noteDrawList.js";
import {
  clearHighwayFx,
  createHighwayFx,
  pruneHighwayFx,
  spawnHitEffect,
  updateShake,
} from "./fxState.js";
import { beatAnchorMs, beatPeriodMs, beatPhase01, beatPulse01 } from "./beatClock.js";
import { resolveTheme } from "./themes/index.js";
import type { HighwaySurface, HighwayTheme } from "./themes/types.js";

// ---------------------------------------------------------------------------
// Playback clock injection
// ---------------------------------------------------------------------------

/**
 * Module-level playback clock getter — injected by the consuming app.
 * Defaults to `() => 0` so the highway renders in a safe idle state if the
 * clock is not registered yet.
 *
 * @see registerNoteHighwayPlaybackClock
 */
let _getPlaybackMs: () => number = () => 0;

/**
 * Register the function that returns the current calibrated playback position
 * in milliseconds. Call once from the consuming app before the highway mounts.
 *
 * Example (overlay-ui):
 * ```ts
 * import { registerNoteHighwayPlaybackClock } from "@spotifyhero/note-highway";
 * import { calibratedPlaybackMs } from "./lib/playbackPosition.js";
 * registerNoteHighwayPlaybackClock(calibratedPlaybackMs);
 * ```
 */
export function registerNoteHighwayPlaybackClock(fn: () => number): void {
  _getPlaybackMs = fn;
}

/** Module-level so the quiet-playback branch does not allocate an array per frame. */
const EMPTY_SORTED: readonly SortedNote[] = [];

/**
 * Canvas 2D highway — the React shell and the rAF loop, and nothing else.
 *
 * Every pixel is a theme's business (`./themes/`), every note position is
 * `./highwayGeometry.ts`, the note scan is `./noteDrawList.ts` and the fx state is
 * `./fxState.ts`. What is left here is: sizing the canvas, owning the mutable
 * per-mount structs, folding score events into visibility, and calling the theme's
 * five draw methods in order.
 *
 * Playhead uses `playbackClock` — smooth extrapolation; Spotify polls only
 * re-anchor on meaningful drift.
 *
 * **The theme is read from the store inside the loop, never from a dep array.** A
 * remount rebuilds `visibility` from empty, which re-shows every note already hit
 * this round; switching look mid-song must not do that.
 */
const NoteHighwayInner = (): React.ReactElement => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chart = useGameStore((s) => s.chart);
  const rafRef = useRef<number>(0);
  const dimsRef = useRef({ cssW: -1, cssH: -1 });
  const surfaceRef = useRef<{ key: string; surface: HighwaySurface } | null>(null);
  const sortedNotesRef = useRef<readonly SortedNote[]>([]);
  /** Occlusion depends only on chart geometry — recomputed when sorted notes refresh, not every rAF. */
  const occludedRef = useRef<ReadonlySet<number>>(EMPTY_OCCLUDED);
  /** Beat-grid phase anchor: the first note head. See `beatClock.ts`. */
  const firstNoteHeadRef = useRef(0);

  useEffect(() => {
    const raw = chart?.notes;
    if (!raw || raw.length === 0) {
      sortedNotesRef.current = [];
      occludedRef.current = EMPTY_OCCLUDED;
      firstNoteHeadRef.current = 0;
      return;
    }
    const sortedNotes = buildSortedNotes(raw);
    sortedNotesRef.current = sortedNotes;
    occludedRef.current = occludedInsideSustain(sortedNotes, CHART_LEAD_IN_MS);
    const first = sortedNotes[0];
    firstNoteHeadRef.current = first ? noteHeadTimeMs(first.note, CHART_LEAD_IN_MS) : 0;
  }, [chart]);

  useEffect(() => {
    if (!chart) return;

    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) return;

    const fx = createHighwayFx();
    const visibility = createNoteVisibility();
    const drawList = createDrawList();
    const frame = createHighwayFrame();

    let perfectStreak = 0;
    let lastVisualPosMs: number | null = null;
    let lastComboBreakSeq = useGameStore.getState().comboBreakSeq;

    /**
     * Read once here and kept current by the listener below, rather than sampled
     * per frame: `matchMedia` is a layout-adjacent read, and this changes roughly
     * never. Consumed by `updateShake` and by the particle spawn.
     */
    const motionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reducedMotion = motionQuery?.matches === true;
    const onMotionChange = (ev: MediaQueryListEvent): void => {
      reducedMotion = ev.matches;
    };
    motionQuery?.addEventListener("change", onMotionChange);

    /** Current look, resolved fresh each frame — and at score-event time, for the burst. */
    const currentTheme = (): HighwayTheme =>
      resolveTheme(useGameStore.getState().settings.highwayTheme);

    const applyOneScoreEvent = (ev: ScoreEvent, ch: Chart, theme: HighwayTheme): void => {
      const note = ch.notes[ev.noteIndex];
      if (!note) return;

      const burst = scoreEventBurstJudgement(ev, note);
      if (burst) {
        const cssW = dimsRef.current.cssW > 0 ? dimsRef.current.cssW : 280;
        const cssH = dimsRef.current.cssH > 0 ? dimsRef.current.cssH : 220;
        const laneWidth = cssW / LANE_COUNT;
        const noteRadius = noteRadiusFromViewport(cssW, cssH);
        spawnHitEffect(
          fx,
          note.lane,
          burst,
          laneCenterX(note.lane, laneWidth),
          hitLineYFromHeight(cssH, noteRadius),
          theme.laneHex(note.lane),
          performance.now(),
          reducedMotion,
          theme.feel
        );
      }

      // Edge pulse trigger is unchanged from the pre-overhaul renderer (every 10th
      // consecutive perfect), deliberately: classic paints this pulse too, and the
      // store's `comboMilestoneSeq` fires on a different rule (every 25 combo).
      if (ev.judgement === "perfect") {
        perfectStreak += 1;
        if (perfectStreak % 10 === 0) {
          fx.edgePulse = { color: theme.laneHex(note.lane), t0: performance.now() };
        }
      } else if (ev.judgement === "miss" || ev.judgement === "bad") {
        perfectStreak = 0;
      }

      applyScoreEventToVisibility(ev, note, visibility);
    };

    const unsubHits = useGameStore.subscribe((state, prev) => {
      if (state.comboBreakSeq !== lastComboBreakSeq) {
        lastComboBreakSeq = state.comboBreakSeq;
        fx.comboBreakAt = performance.now();
      }
      if (state.scoreEventSeq === prev.scoreEventSeq) return;
      const batch = state.lastScoreEventBatch;
      if (!batch?.length) return;
      const ch = state.chart;
      if (!ch) return;
      const theme = resolveTheme(state.settings.highwayTheme);
      for (const ev of batch) {
        applyOneScoreEvent(ev, ch, theme);
      }
    });

    const onLaneDown = (ev: Event): void => {
      const lane = (ev as CustomEvent<{ lane: number }>).detail?.lane;
      if (lane === undefined || lane < 0 || lane >= LANE_COUNT) return;
      const press = fx.receptorPress[lane];
      if (!press) return;
      press.isDown = true;
      press.downAt = performance.now();
    };
    const onLaneUp = (ev: Event): void => {
      const lane = (ev as CustomEvent<{ lane: number }>).detail?.lane;
      if (lane === undefined || lane < 0 || lane >= LANE_COUNT) return;
      const press = fx.receptorPress[lane];
      if (!press) return;
      press.isDown = false;
      press.upAt = performance.now();
    };
    window.addEventListener("spotifyhero:lanedown", onLaneDown);
    window.addEventListener("spotifyhero:laneup", onLaneUp);

    /**
     * Cached backdrop, keyed by everything it depends on — including the theme id,
     * so a look switch rebuilds it on the next frame with no remount.
     */
    const surfaceFor = (
      theme: HighwayTheme,
      lw: number,
      lh: number,
      dpr: number
    ): HighwaySurface => {
      const key = `${theme.id}|${Math.round(lw)}x${Math.round(lh)}|${dpr}`;
      const prev = surfaceRef.current;
      if (prev?.key === key) return prev.surface;
      const surface = theme.buildSurface(ctx, lw, lh, dpr);
      surfaceRef.current = { key, surface };
      return surface;
    };

    /**
     * `resized` is true only on the frame that actually changed the backing
     * store — the frozen branch below needs it to know when a repaint is owed.
     */
    const resizeIfNeeded = (): {
      dpr: number;
      lw: number;
      lh: number;
      resized: boolean;
    } => {
      const cssW = Math.max(2, wrap.clientWidth);
      const cssH = Math.max(2, wrap.clientHeight);
      const { cssW: ow, cssH: oh } = dimsRef.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      let resized = false;
      if (cssW !== ow || cssH !== oh) {
        resized = true;
        dimsRef.current = { cssW, cssH };
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        surfaceRef.current = null;
      }

      return { dpr, lw: canvas.width / dpr, lh: canvas.height / dpr, resized };
    };

    /** Clear to the theme's base colour and blit its cached backdrop, at identity. */
    const blitBackdrop = (surface: HighwaySurface, theme: HighwayTheme): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = theme.clearColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(surface.bg, 0, 0);
    };

    const loop = (): void => {
      rafRef.current = requestAnimationFrame(loop);

      const state = useGameStore.getState();
      const c = state.chart;
      const theme = currentTheme();
      const frozen =
        state.trackLifecycle === "ending" ||
        state.trackLifecycle === "loading" ||
        state.trackLifecycle === "generating" ||
        !PLAYABLE_PHASES.has(state.phase) ||
        !c;

      // Resized *before* the frozen check, not after. Pausing freezes this loop,
      // and a canvas left at its old pixel size while the window grows leaves the
      // new space unpainted — the black void that used to appear when you paused
      // and then resized, filling in only on resume.
      const dim = resizeIfNeeded();

      if (frozen) {
        clearNoteVisibility(visibility);
        // Backdrop only. The playhead is frozen too, and while paused
        // `shouldHideNotesForQuietPlayback` paints no notes anyway, so this is
        // the same picture a full repaint would produce — minus the risk of
        // re-showing notes whose visibility state was just cleared.
        if (dim.resized && dim.lw >= 2 && dim.lh >= 2) {
          blitBackdrop(surfaceFor(theme, dim.lw, dim.lh, dim.dpr), theme);
        }
        return;
      }
      // Already implied by `frozen`; the compiler cannot see that through a
      // boolean, so restate it rather than assert below.
      if (!c) return;
      if (dim.lw < 2 || dim.lh < 2) return;

      const { dpr, lw, lh } = dim;
      const pos = _getPlaybackMs() + (state.settings.visualNoteOffsetMs ?? 0);
      if (lastVisualPosMs !== null && pos < lastVisualPosMs - VISUAL_RESET_BACKWARD_JUMP_MS) {
        clearHighwayFx(fx);
        clearNoteVisibility(visibility);
        perfectStreak = 0;
      }
      lastVisualPosMs = pos;

      const spd = Math.min(5, Math.max(0.45, state.settings.noteScrollSpeed ?? 1));
      const noteRadius = noteRadiusFromViewport(lw, lh);
      const hitLineY = hitLineYFromHeight(lh, noteRadius);
      const lookAheadEffective = LOOK_AHEAD_MS / spd;
      const beatMs = beatPeriodMs(c.bpm);
      const anchor = beatAnchorMs(firstNoteHeadRef.current, beatMs);
      const phase = beatPhase01(pos, beatMs, anchor);
      const nowFx = performance.now();

      frame.w = lw;
      frame.h = lh;
      frame.dpr = dpr;
      frame.laneWidth = lw / LANE_COUNT;
      frame.noteRadius = noteRadius;
      frame.hitLineY = hitLineY;
      frame.pxPerMs = hitLineY / lookAheadEffective;
      frame.positionMs = pos;
      frame.nowMs = nowFx;
      frame.lookAheadMs = lookAheadEffective;
      frame.beatMs = beatMs;
      frame.beatAnchorMs = anchor;
      frame.beatPhase01 = phase;
      frame.beatPulse01 = beatPulse01(phase);
      frame.combo = state.combo;
      frame.reducedMotion = reducedMotion;

      pruneHighwayFx(fx, nowFx, HIT_FX_MS);
      updateShake(fx.shake, nowFx, reducedMotion);

      const notesToPaint = shouldHideNotesForQuietPlayback(state.playback, state.phase)
        ? EMPTY_SORTED
        : sortedNotesRef.current;
      buildDrawList(
        drawList,
        notesToPaint,
        c.notes,
        visibility,
        occludedRef.current,
        frame
      );

      const surface = surfaceFor(theme, lw, lh, dpr);
      blitBackdrop(surface, theme);

      // Shake is a canvas transform on the moving layers only — the backdrop above
      // is blitted at identity, so the lanes stay put and the notes kick.
      ctx.setTransform(dpr, 0, 0, dpr, dpr * fx.shake.ox, dpr * fx.shake.oy);

      theme.drawBackdropFx(ctx, surface, frame, fx);
      theme.drawNotes(ctx, surface, frame, drawList);
      theme.drawOverlay(ctx, surface, frame, fx);
      theme.drawReceptors(ctx, surface, frame, fx);
      theme.drawImpactFx(ctx, surface, frame, fx);
    };

    dimsRef.current = { cssW: -1, cssH: -1 };
    resizeIfNeeded();
    rafRef.current = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      surfaceRef.current = null;
    });
    ro.observe(wrap);

    return () => {
      unsubHits();
      motionQuery?.removeEventListener("change", onMotionChange);
      window.removeEventListener("spotifyhero:lanedown", onLaneDown);
      window.removeEventListener("spotifyhero:laneup", onLaneUp);
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      surfaceRef.current = null;
      dimsRef.current = { cssW: -1, cssH: -1 };
      clearHighwayFx(fx);
      clearNoteVisibility(visibility);
      drawList.length = 0;
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
