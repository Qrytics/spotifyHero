import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore.js";
import { ScoringEngine, PlayModeController, NoteWindowManager } from "@spotifyhero/gameplay-core";
import type { Chart } from "@spotifyhero/shared-types";

/**
 * useGameLoop
 *
 * Drives the per-frame game loop:
 *   - Tracks playback position against the active chart.
 *   - In autoplay mode, fires hits for notes in the perfect window.
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
  const judgedRef = useRef<Set<number>>(new Set());
  /** Detect Spotify seek / skip / rewind — large jumps invalidate hit bookkeeping. */
  const lastPlaybackPosRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const playModeRef = useRef(
    new PlayModeController(settings.autoplay ? "autoplay" : "manual")
  );

  // Rebuild engine whenever chart changes
  useEffect(() => {
    if (!chart) return;
    engineRef.current = new ScoringEngine(chart);
    windowManagerRef.current = new NoteWindowManager(chart);
    judgedRef.current = new Set();
    lastPlaybackPosRef.current = null;
    playModeRef.current.setMode(settings.autoplay ? "autoplay" : "manual");
    // settings.autoplay is intentionally read once here at chart load time;
    // live setting changes are synced by the phase-listener effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  // Sync autoplay setting with controller whenever phase changes
  useEffect(() => {
    playModeRef.current.setMode(
      phase === "autoplay" ? "autoplay" : "manual"
    );
  }, [phase]);

  // Run the game loop via requestAnimationFrame
  useEffect(() => {
    if (phase !== "autoplay" && phase !== "manual") {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    if (!chart) return;

    const loop = () => {
      const state = useGameStore.getState();
      if (state.phase !== "autoplay" && state.phase !== "manual") return;

      const pos = state.playback?.positionMs ?? 0;
      const engine = engineRef.current;
      const windowManager = windowManagerRef.current;
      if (!engine || !windowManager) return;

      const prev = lastPlaybackPosRef.current;
      lastPlaybackPosRef.current = pos;
      if (prev !== null && Math.abs(pos - prev) > 1500) {
        judgedRef.current = new Set();
      }

      // Autoplay hits – read actions from store directly to avoid stale closures
      if (playModeRef.current.isAutoplay()) {
        const hits = windowManager.getAutoplayHits(pos);
        for (const { index } of hits) {
          if (!judgedRef.current.has(index)) {
            judgedRef.current.add(index);
            const event = engine.onNoteHit(index, pos);
            if (event) {
              useGameStore.getState().onScoreEvent(event, chart.notes.length);
            }
          }
        }
      }

      // Miss detection
      const missed = windowManager.getMissedNotes(pos, judgedRef.current);
      for (const { index } of missed) {
        judgedRef.current.add(index);
        const event = engine.onNoteMissed(index);
        if (event) {
          useGameStore.getState().onScoreEvent(event, chart.notes.length);
        }
      }

      // End of chart detection (3 s after last note)
      const lastNote = chart.notes[chart.notes.length - 1];
      if (lastNote && pos > lastNote.timeMs + 3000) {
        const currentState = useGameStore.getState();
        const session = engine.finalize(currentState.settings.playerName);
        currentState.setSession(session);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // phase and chart are the only stable triggers; store callbacks are
    // accessed via getState() inside the loop to avoid stale closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, chart]);
}
