import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore.js";
import {
  ScoringEngine,
  PlayModeController,
  NoteWindowManager,
  DEFAULT_HIT_WINDOWS,
} from "@spotifyhero/gameplay-core";
import type { Chart } from "@spotifyhero/shared-types";
import { playbackClock } from "../lib/playbackClock.js";

function chartEndMs(chart: Chart): number {
  let max = 0;
  for (const n of chart.notes) {
    const t = n.timeMs + (n.durationMs ?? 0);
    if (t > max) max = t;
  }
  return max;
}

/** Closest note head on a lane within the bad hit window — for manual taps. */
function bestLaneHitIndex(
  chart: Chart,
  lane: number,
  positionMs: number,
  engine: ScoringEngine
): number | null {
  let bestIdx: number | null = null;
  let bestAbs = Infinity;
  const win = DEFAULT_HIT_WINDOWS.bad;
  for (let i = 0; i < chart.notes.length; i++) {
    const note = chart.notes[i];
    if (!note || note.lane !== lane) continue;
    if (engine.isResolved(i)) continue;

    const delta = positionMs - note.timeMs;
    if (Math.abs(delta) <= win) {
      const a = Math.abs(delta);
      if (a < bestAbs) {
        bestAbs = a;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

/**
 * Re-anchor transport to current Spotify playback when a chart mounts so we never
 * judge the new chart using the previous song's timeline (instant mass-miss bug).
 */
function syncClockToStorePlayback(chart: Chart): void {
  const pb = useGameStore.getState().playback;
  if (!pb?.trackId || pb.trackId !== chart.trackId) return;
  playbackClock.sync(
    pb.positionMs ?? 0,
    pb.isPlaying ?? false,
    pb.trackId
  );
}

/**
 * useGameLoop
 *
 * Drives the per-frame game loop:
 *   - Tracks playback position against the active chart.
 *   - In autoplay mode, fires hits for notes in the perfect window.
 *   - Resolves sustain checkpoints and early release.
 *   - Marks missed notes.
 *   - Pushes ScoreEvents to the store via useGameStore.getState() to
 *     avoid stale-closure issues with the RAF loop.
 */
export function useGameLoop(): void {
  const chart = useGameStore((s) => s.chart);
  const phase = useGameStore((s) => s.phase);
  const settings = useGameStore((s) => s.settings);

  const engineRef = useRef<ScoringEngine | null>(null);
  const windowManagerRef = useRef<NoteWindowManager | null>(null);
  const lanesHeldRef = useRef<boolean[]>([false, false, false, false]);
  const lastPlaybackPosRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const playModeRef = useRef(
    new PlayModeController(settings.autoplay ? "autoplay" : "manual")
  );

  useEffect(() => {
    if (!chart) return;
    engineRef.current = new ScoringEngine(chart);
    windowManagerRef.current = new NoteWindowManager(chart);
    lanesHeldRef.current = [false, false, false, false];
    lastPlaybackPosRef.current = null;
    playModeRef.current.setMode(settings.autoplay ? "autoplay" : "manual");
    syncClockToStorePlayback(chart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  useEffect(() => {
    playModeRef.current.setMode(
      phase === "autoplay" ? "autoplay" : "manual"
    );
  }, [phase]);

  useEffect(() => {
    const down = (ev: Event): void => {
      const ce = ev as CustomEvent<{ lane: number }>;
      const lane = ce.detail?.lane;
      if (lane === undefined || lane < 0 || lane > 3) return;
      lanesHeldRef.current[lane] = true;
    };
    const up = (ev: Event): void => {
      const ce = ev as CustomEvent<{ lane: number }>;
      const lane = ce.detail?.lane;
      if (lane === undefined || lane < 0 || lane > 3) return;
      lanesHeldRef.current[lane] = false;
    };

    window.addEventListener("spotifyhero:lanedown", down);
    window.addEventListener("spotifyhero:laneup", up);
    return () => {
      window.removeEventListener("spotifyhero:lanedown", down);
      window.removeEventListener("spotifyhero:laneup", up);
    };
  }, []);

  useEffect(() => {
    if (!chart) return;

    const onLaneHit = (ev: Event): void => {
      const ce = ev as CustomEvent<{ lane: number }>;
      const lane = ce.detail?.lane;
      if (lane === undefined || lane < 0 || lane > 3) return;

      const state = useGameStore.getState();
      if (state.phase !== "manual") return;

      const pos = playbackClock.estimateMs();
      const engine = engineRef.current;
      const c = state.chart;
      if (!engine || !c) return;

      const idx = bestLaneHitIndex(c, lane, pos, engine);
      if (idx === null) return;

      const scoreEvent = engine.onNoteHit(idx, pos);
      if (scoreEvent) {
        useGameStore.getState().onScoreEvent(scoreEvent, c.notes.length);
      }
    };

    window.addEventListener("spotifyhero:lanehit", onLaneHit);
    return () => window.removeEventListener("spotifyhero:lanehit", onLaneHit);
  }, [chart]);

  useEffect(() => {
    if (phase !== "autoplay" && phase !== "manual") {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    if (!chart) return;

    const loop = () => {
      const state = useGameStore.getState();
      if (state.phase !== "autoplay" && state.phase !== "manual") return;

      const pos = playbackClock.estimateMs();
      const engine = engineRef.current;
      if (!engine) return;

      const prev = lastPlaybackPosRef.current;
      lastPlaybackPosRef.current = pos;
      if (prev !== null && Math.abs(pos - prev) > 1500) {
        engine.resetSeekState();
        lanesHeldRef.current = [false, false, false, false];
      }

      const laneHeld =
        playModeRef.current.isAutoplay() ? null : lanesHeldRef.current;

      if (playModeRef.current.isAutoplay()) {
        const windowManager = windowManagerRef.current;
        if (windowManager) {
          const hits = windowManager.getAutoplayHits(pos);
          for (const { index } of hits) {
            if (!engine.isResolved(index)) {
              const event = engine.onNoteHit(index, pos);
              if (event) {
                useGameStore.getState().onScoreEvent(event, chart.notes.length);
              }
            }
          }
        }
      }

      const holdEvents = engine.advanceHolds(pos, laneHeld);
      for (const ev of holdEvents) {
        useGameStore.getState().onScoreEvent(ev, chart.notes.length);
      }

      const missed = engine.evaluateMisses(pos);
      for (const event of missed) {
        useGameStore.getState().onScoreEvent(event, chart.notes.length);
      }

      const endMs = chartEndMs(chart);
      if (endMs > 0 && pos > endMs + 3000) {
        const currentState = useGameStore.getState();
        const session = engine.finalize(currentState.settings.playerName);
        currentState.setSession(session);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, chart]);
}
