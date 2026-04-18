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
 *   - Pushes ScoreEvents to the store.
 */
export function useGameLoop(): void {
  const chart = useGameStore((s) => s.chart);
  const playback = useGameStore((s) => s.playback);
  const phase = useGameStore((s) => s.phase);
  const onScoreEvent = useGameStore((s) => s.onScoreEvent);
  const setSession = useGameStore((s) => s.setSession);
  const settings = useGameStore((s) => s.settings);

  const engineRef = useRef<ScoringEngine | null>(null);
  const windowManagerRef = useRef<NoteWindowManager | null>(null);
  const judgedRef = useRef<Set<number>>(new Set());
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
    playModeRef.current.setMode(settings.autoplay ? "autoplay" : "manual");
  }, [chart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync autoplay setting with controller
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
    if (!chart || !playback) return;

    const positionMs = playback.positionMs;
    const engine = engineRef.current;
    const windowManager = windowManagerRef.current;
    if (!engine || !windowManager) return;

    const loop = () => {
      if (phase !== "autoplay" && phase !== "manual") return;
      const pos = useGameStore.getState().playback?.positionMs ?? 0;

      // Autoplay hits
      if (playModeRef.current.isAutoplay()) {
        const hits = windowManager.getAutoplayHits(pos);
        for (const { index } of hits) {
          if (!judgedRef.current.has(index)) {
            judgedRef.current.add(index);
            const event = engine.onNoteHit(index, pos);
            if (event) onScoreEvent(event, chart.notes.length);
          }
        }
      }

      // Miss detection
      const missed = windowManager.getMissedNotes(pos, judgedRef.current);
      for (const { index } of missed) {
        judgedRef.current.add(index);
        const event = engine.onNoteMissed(index);
        if (event) onScoreEvent(event, chart.notes.length);
      }

      // End of chart detection
      const lastNote = chart.notes[chart.notes.length - 1];
      if (lastNote && pos > lastNote.timeMs + 3000) {
        const session = engine.finalize(
          useGameStore.getState().settings.playerName
        );
        setSession(session);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, chart, playback]); // eslint-disable-line react-hooks/exhaustive-deps
}
