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

/** Grace after last chart event before we treat the chart as finished. */
const CHART_FINISH_PAD_MS = 3000;
/** Right after a chart mounts, an extrapolated playhead past the chart end is usually a stale clock from the previous song — re-anchor once. */
const CHART_MOUNT_STALE_MS = 2500;
/**
 * If we joined after the chart tail, every note may already be "past" — allow results
 * only after many frames so repeated clock sync can recover a stale transport first.
 */
const FINISH_STALE_WAIT_FRAMES = 180;

/** Manual + no lane input + this many consecutive note misses → switch to autoplay. */
const AFK_MISS_THRESHOLD = 5;

function allNotesResolved(engine: ScoringEngine, chart: Chart): boolean {
  for (let i = 0; i < chart.notes.length; i++) {
    if (!engine.isResolved(i)) return false;
  }
  return true;
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

/** Notes are still scrolling in the playable window (not past the chart end). */
function notesScrollingRegion(
  posMs: number,
  endMs: number,
  noteCount: number
): boolean {
  return (
    noteCount > 0 &&
    endMs > 0 &&
    posMs <= endMs + CHART_FINISH_PAD_MS
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
  /** Re-sync clock on first frames after track/chart change (store timing may settle after mount). */
  const clockSyncedTrackRef = useRef<string | null>(null);
  const chartMountPerfRef = useRef(0);
  const loopFramesForChartRef = useRef(0);
  const sawPlayheadInChartTailRef = useRef(false);
  /** One-shot "impossibly past end" recovery right after chart mount (stale timeline). */
  const mountStaleResyncDoneRef = useRef(false);
  /** Consecutive tap misses while no lane keys held (manual mode AFK detection). */
  const consecutiveAfkMissRef = useRef(0);

  useEffect(() => {
    if (!chart) return;
    engineRef.current = new ScoringEngine(chart);
    windowManagerRef.current = new NoteWindowManager(chart);
    lanesHeldRef.current = [false, false, false, false];
    lastPlaybackPosRef.current = null;
    chartMountPerfRef.current = performance.now();
    loopFramesForChartRef.current = 0;
    sawPlayheadInChartTailRef.current = false;
    mountStaleResyncDoneRef.current = false;
    consecutiveAfkMissRef.current = 0;
    playModeRef.current.setMode(settings.autoplay ? "autoplay" : "manual");
    syncClockToStorePlayback(chart);
    clockSyncedTrackRef.current = chart.trackId;
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
      consecutiveAfkMissRef.current = 0;
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
        consecutiveAfkMissRef.current = 0;
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

      const liveChart = state.chart;
      if (!liveChart) return;

      if (clockSyncedTrackRef.current !== liveChart.trackId) {
        syncClockToStorePlayback(liveChart);
        clockSyncedTrackRef.current = liveChart.trackId;
      }

      let pos = playbackClock.estimateMs();
      const engine = engineRef.current;
      if (!engine) return;

      loopFramesForChartRef.current += 1;

      const endMs = chartEndMs(liveChart);
      const sinceChartMount =
        performance.now() - chartMountPerfRef.current;

      if (
        endMs > 0 &&
        !mountStaleResyncDoneRef.current &&
        sinceChartMount < CHART_MOUNT_STALE_MS &&
        pos > endMs + CHART_FINISH_PAD_MS
      ) {
        mountStaleResyncDoneRef.current = true;
        syncClockToStorePlayback(liveChart);
        engine.resetSeekState();
        lanesHeldRef.current = [false, false, false, false];
        lastPlaybackPosRef.current = null;
        clockSyncedTrackRef.current = liveChart.trackId;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      if (
        endMs > 0 &&
        !sawPlayheadInChartTailRef.current &&
        pos > endMs + CHART_FINISH_PAD_MS &&
        loopFramesForChartRef.current <= 90
      ) {
        syncClockToStorePlayback(liveChart);
        pos = playbackClock.estimateMs();
      }

      if (endMs <= 0 || pos <= endMs + CHART_FINISH_PAD_MS) {
        sawPlayheadInChartTailRef.current = true;
      }

      const prev = lastPlaybackPosRef.current;
      lastPlaybackPosRef.current = pos;
      if (prev !== null && Math.abs(pos - prev) > 1500) {
        engine.resetSeekState();
        lanesHeldRef.current = [false, false, false, false];
      }

      const laneHeld =
        playModeRef.current.isAutoplay() ? null : lanesHeldRef.current;

      const noteCount = liveChart.notes.length;

      if (playModeRef.current.isAutoplay()) {
        const windowManager = windowManagerRef.current;
        if (windowManager) {
          const hits = windowManager.getAutoplayHits(pos);
          for (const { index } of hits) {
            if (!engine.isResolved(index)) {
              const event = engine.onNoteHit(index, pos);
              if (event) {
                useGameStore.getState().onScoreEvent(event, noteCount);
              }
            }
          }
        }
      }

      const holdEvents = engine.advanceHolds(pos, laneHeld);
      for (const ev of holdEvents) {
        useGameStore.getState().onScoreEvent(ev, noteCount);
        if (
          playModeRef.current.isAutoplay() === false &&
          ev.judgement !== "miss"
        ) {
          consecutiveAfkMissRef.current = 0;
        }
      }

      const missed = engine.evaluateMisses(pos);
      for (const event of missed) {
        useGameStore.getState().onScoreEvent(event, noteCount);
      }

      if (!playModeRef.current.isAutoplay()) {
        if (lanesHeldRef.current.some(Boolean)) {
          consecutiveAfkMissRef.current = 0;
        } else if (
          notesScrollingRegion(pos, endMs, liveChart.notes.length)
        ) {
          for (const ev of missed) {
            if (ev.judgement !== "miss") continue;
            consecutiveAfkMissRef.current += 1;
            if (consecutiveAfkMissRef.current >= AFK_MISS_THRESHOLD) {
              consecutiveAfkMissRef.current = 0;
              useGameStore.setState({
                phase: "autoplay",
                lastPlayPhase: "autoplay",
              });
              playModeRef.current.setMode("autoplay");
              break;
            }
          }
        }
      } else {
        consecutiveAfkMissRef.current = 0;
      }

      const pastChartFinish =
        endMs > 0 && pos > endMs + CHART_FINISH_PAD_MS;
      const canFinishResults =
        sawPlayheadInChartTailRef.current ||
        (loopFramesForChartRef.current > FINISH_STALE_WAIT_FRAMES &&
          allNotesResolved(engine, liveChart));

      if (pastChartFinish && canFinishResults) {
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
