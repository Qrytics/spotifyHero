import { useEffect } from "react";
import { HybridChartGenerator } from "@spotifyhero/chart-generator";
import type { BeatEvent, SpotifyTrack } from "@spotifyhero/shared-types";
import { useGameStore } from "../store/gameStore.js";

function hashTrackId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/**
 * Builds a beat/onset grid when no Spotify beat analysis exists.
 * Quarter / eighth / sixteenth subdivisions with descending confidence so the
 * generator’s confidence-first density filter can separate Easy (strong beats) from Expert (full grid).
 * Coincident times keep the highest-confidence event.
 */
function demoBeatEvents(track: SpotifyTrack): { events: BeatEvent[]; bpm: number } {
  const bpm = track.bpm ?? 120;
  const beatMs = 60_000 / bpm;
  const phase = hashTrackId(track.id) % Math.max(1, Math.floor(beatMs));
  const eighth = beatMs / 2;
  const sixteenth = beatMs / 4;

  const byTime = new Map<number, BeatEvent>();

  const add = (timeMs: number, confidence: number): void => {
    const k = Math.round(timeMs);
    if (k < 0 || k >= track.durationMs) return;
    const prev = byTime.get(k);
    if (!prev || confidence > prev.confidence) {
      byTime.set(k, {
        timeMs: k,
        confidence,
        isBeat: true,
        isOnset: true,
      });
    }
  };

  for (let t = phase; t < track.durationMs; t += beatMs) {
    add(t, 0.94);
  }
  for (let t = phase; t < track.durationMs; t += eighth) {
    add(t, 0.71);
  }
  let sixIdx = 0;
  for (let t = phase; t < track.durationMs; t += sixteenth, sixIdx++) {
    if (sixIdx % 2 === 1) continue;
    add(t, 0.34);
  }

  const events = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
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
