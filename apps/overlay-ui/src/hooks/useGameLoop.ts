import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore.js";
import {
  ScoringEngine,
  PlayModeController,
  NoteWindowManager,
  DEFAULT_HIT_WINDOWS,
  CHART_LEAD_IN_MS,
  chartEndPlaybackMs,
  noteHeadTimeMs,
} from "@spotifyhero/gameplay-core";
import type { Chart } from "@spotifyhero/shared-types";
import { playbackClock } from "../lib/playbackClock.js";
import { resumeSpotifyPlayback } from "../lib/spotifyControl.js";
import {
  isSpotifyPlaybackTooQuietForNotes,
  shouldHideNotesForQuietPlayback,
} from "../lib/playbackVolumeGate.js";

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
/**
 * After a physical key-up, treat the lane as still held briefly for sustain checkpoints only.
 * Stops one-frame gaps / OS input jitter from failing an otherwise solid long hold.
 */
const SUSTAIN_LANE_HELD_GRACE_MS = 55;
const EXPERT_HIT_WINDOWS = {
  perfect: 18,
  great: 36,
  good: 72,
  bad: 112,
} as const;

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

    const head = noteHeadTimeMs(note, CHART_LEAD_IN_MS);
    const delta = positionMs - head;
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

function chartStartPlaybackMs(chart: Chart): number {
  if (chart.notes.length === 0) return 0;
  let min = Infinity;
  for (const note of chart.notes) {
    const t = noteHeadTimeMs(note, CHART_LEAD_IN_MS);
    if (t < min) min = t;
  }
  return Number.isFinite(min) ? min : 0;
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
  /** Last `performance.now()` each lane reported down (raw), for sustain grace only. */
  const laneLastHeldTruePerfRef = useRef<number[]>([
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]);
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
  const chartBoundsRef = useRef<{ startMs: number; endMs: number }>({
    startMs: 0,
    endMs: 0,
  });
  const countdownResumedTrackRef = useRef<string | null>(null);
  const usedAutoplayRef = useRef(false);

  useEffect(() => {
    if (!chart) return;
    engineRef.current = new ScoringEngine(chart, {
      windows: chart.difficulty === "expert" ? EXPERT_HIT_WINDOWS : DEFAULT_HIT_WINDOWS,
      chartLeadInMs: CHART_LEAD_IN_MS,
    });
    windowManagerRef.current = new NoteWindowManager(
      chart,
      2000,
      chart.difficulty === "expert" ? EXPERT_HIT_WINDOWS : DEFAULT_HIT_WINDOWS,
      CHART_LEAD_IN_MS
    );
    lanesHeldRef.current = [false, false, false, false];
    laneLastHeldTruePerfRef.current = [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    lastPlaybackPosRef.current = null;
    chartMountPerfRef.current = performance.now();
    loopFramesForChartRef.current = 0;
    sawPlayheadInChartTailRef.current = false;
    mountStaleResyncDoneRef.current = false;
    consecutiveAfkMissRef.current = 0;
    chartBoundsRef.current = {
      startMs: chartStartPlaybackMs(chart),
      endMs: chartEndPlaybackMs(chart, CHART_LEAD_IN_MS),
    };
    countdownResumedTrackRef.current = null;
    playModeRef.current.setMode(settings.autoplay ? "autoplay" : "manual");
    usedAutoplayRef.current = settings.autoplay;
    useGameStore.setState({ usedAutoplayThisRound: settings.autoplay });
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
      if (isSpotifyPlaybackTooQuietForNotes(state.playback)) return;

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

      if (shouldHideNotesForQuietPlayback(state.playback, state.phase)) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      if (state.trackLifecycle === "countdown") {
        const countdownDone =
          state.countdownUntilMs === null || Date.now() >= state.countdownUntilMs;
        if (!countdownDone) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        useGameStore.setState({ trackLifecycle: "playing", countdownUntilMs: null });
        if (countdownResumedTrackRef.current !== liveChart.trackId) {
          countdownResumedTrackRef.current = liveChart.trackId;
          void resumeSpotifyPlayback();
        }
      }

      if (state.playback?.trackId !== liveChart.trackId) {
        windowManagerRef.current = null;
        engineRef.current = null;
        useGameStore.setState({ trackLifecycle: "ending", lastScoreEvent: null });
        return;
      }

      if (clockSyncedTrackRef.current !== liveChart.trackId) {
        syncClockToStorePlayback(liveChart);
        clockSyncedTrackRef.current = liveChart.trackId;
      }

      let pos = playbackClock.estimateMs();
      const engine = engineRef.current;
      if (!engine) return;

      loopFramesForChartRef.current += 1;

      const { startMs, endMs } = chartBoundsRef.current;
      const reportedDurationMs = state.playback?.track?.durationMs ?? 0;
      const effectiveEndMs =
        endMs > 0 && reportedDurationMs > 0
          ? Math.min(endMs, reportedDurationMs)
          : endMs;
      const sinceChartMount =
        performance.now() - chartMountPerfRef.current;

      if (
        effectiveEndMs > 0 &&
        !mountStaleResyncDoneRef.current &&
        sinceChartMount < CHART_MOUNT_STALE_MS &&
        pos > effectiveEndMs + CHART_FINISH_PAD_MS
      ) {
        mountStaleResyncDoneRef.current = true;
        syncClockToStorePlayback(liveChart);
        engine.resetSeekState();
        lastPlaybackPosRef.current = null;
        clockSyncedTrackRef.current = liveChart.trackId;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      if (
        effectiveEndMs > 0 &&
        !sawPlayheadInChartTailRef.current &&
        pos > effectiveEndMs &&
        loopFramesForChartRef.current <= 90
      ) {
        syncClockToStorePlayback(liveChart);
        pos = playbackClock.estimateMs();
      }

      if (effectiveEndMs <= 0 || pos <= effectiveEndMs) {
        sawPlayheadInChartTailRef.current = true;
      }

      const boundedPos = Math.min(Math.max(pos, startMs), effectiveEndMs || pos);

      const prev = lastPlaybackPosRef.current;
      lastPlaybackPosRef.current = boundedPos;
      // Large *backward* jumps (seek) need a scoring reset. Forward jumps (catch-up after
      // throttled rAF or Spotify poll) must NOT clear active holds or lane keys — that was
      // causing sustains to vanish / fail while the player still held the key.
      if (prev !== null && boundedPos < prev - 3000) {
        engine.resetSeekState();
      }

      const laneHeld: boolean[] | null = playModeRef.current.isAutoplay()
        ? null
        : (() => {
            const raw = lanesHeldRef.current;
            const nowPerf = performance.now();
            const out: boolean[] = [false, false, false, false];
            for (let l = 0; l < 4; l++) {
              if (raw[l] === true) {
                laneLastHeldTruePerfRef.current[l] = nowPerf;
                out[l] = true;
              } else {
                const lastTrue = laneLastHeldTruePerfRef.current[l]!;
                out[l] = nowPerf - lastTrue < SUSTAIN_LANE_HELD_GRACE_MS;
              }
            }
            return out;
          })();

      const noteCount = liveChart.notes.length;

      if (playModeRef.current.isAutoplay()) {
        if (!usedAutoplayRef.current) {
          usedAutoplayRef.current = true;
          useGameStore.setState({ usedAutoplayThisRound: true });
        }
        const windowManager = windowManagerRef.current;
        if (windowManager) {
          const hits = windowManager.getAutoplayHits(boundedPos);
          for (const { index } of hits) {
            if (!engine.isResolved(index)) {
              const event = engine.onNoteHit(index, boundedPos);
              if (event) {
                useGameStore.getState().onScoreEvent(event, noteCount);
              }
            }
          }
        }
      }

      const holdEvents = engine.advanceHolds(boundedPos, laneHeld);
      for (const ev of holdEvents) {
        useGameStore.getState().onScoreEvent(ev, noteCount);
        if (
          playModeRef.current.isAutoplay() === false &&
          ev.judgement !== "miss"
        ) {
          consecutiveAfkMissRef.current = 0;
        }
      }

      const missed = engine.evaluateMisses(boundedPos);
      for (const event of missed) {
        useGameStore.getState().onScoreEvent(event, noteCount);
      }

      if (!playModeRef.current.isAutoplay()) {
        if (lanesHeldRef.current.some(Boolean)) {
          consecutiveAfkMissRef.current = 0;
        } else if (
          notesScrollingRegion(boundedPos, effectiveEndMs, liveChart.notes.length)
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
        effectiveEndMs > 0 && pos >= effectiveEndMs;
      const canFinishResults =
        sawPlayheadInChartTailRef.current ||
        (loopFramesForChartRef.current > FINISH_STALE_WAIT_FRAMES &&
          allNotesResolved(engine, liveChart));

      if (pastChartFinish && canFinishResults) {
        useGameStore.setState({ trackLifecycle: "ending" });
        const currentState = useGameStore.getState();
        const displayName = currentState.spotifyUser?.displayName?.trim();
        const session = engine.finalize(
          displayName || currentState.settings.playerName
        );
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
