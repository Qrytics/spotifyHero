import { useEffect } from "react";
import { HybridChartGenerator } from "@spotifyhero/chart-generator";
import type { BeatEvent, SpotifyTrack } from "@spotifyhero/shared-types";
import { useGameStore } from "../store/gameStore.js";

/**
 * Builds a simple beat/onset grid for browser demo when no Spotify beat analysis exists.
 */
function demoBeatEvents(track: SpotifyTrack): { events: BeatEvent[]; bpm: number } {
  const bpm = track.bpm ?? 120;
  const beatMs = 60_000 / bpm;
  const events: BeatEvent[] = [];
  for (let t = 0; t < track.durationMs; t += beatMs) {
    events.push({
      timeMs: Math.round(t),
      confidence: 0.9,
      isBeat: true,
      isOnset: true,
    });
  }
  return { events, bpm };
}

/**
 * When playback switches to a new track, the store enters `loading` until a chart exists.
 * Runs hybrid generation (deterministic + optional ML stub) and calls `setChart`.
 */
export function useChartGeneration(): void {
  const phase = useGameStore((s) => s.phase);
  const trackId = useGameStore((s) => s.playback?.trackId ?? null);

  useEffect(() => {
    if (phase !== "loading" || !trackId) return;

    const playback = useGameStore.getState().playback;
    const track = playback?.track;
    if (!playback?.trackId || !track || playback.trackId !== trackId) return;

    let cancelled = false;
    const gen = new HybridChartGenerator();

    void (async () => {
      try {
        const { events, bpm } = demoBeatEvents(track);
        const chart = await gen.generate(trackId, events, bpm, {
          difficulty: useGameStore.getState().settings.difficulty,
        });
        if (cancelled) return;
        const latest = useGameStore.getState();
        if (
          latest.phase !== "loading" ||
          latest.playback?.trackId !== trackId
        ) {
          return;
        }
        latest.setChart(chart);
      } catch (err) {
        console.error("[spotifyHero] chart generation failed:", err);
        if (!cancelled) {
          useGameStore.getState().setPhase("idle");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, trackId]);
}
