import { useEffect } from "react";
import { HybridChartGenerator } from "@spotifyhero/chart-generator";
import type { BeatEvent, SpotifyTrack } from "@spotifyhero/shared-types";
import { useGameStore } from "../store/gameStore.js";

/**
 * Builds a beat/onset grid when no Spotify beat analysis exists.
 * Quarter / eighth / sixteenth subdivisions with descending confidence so the
 * generator’s confidence-first density filter can separate Easy (strong beats) from Expert (full grid).
 * Coincident times keep the highest-confidence event.
 */
function demoBeatEvents(track: SpotifyTrack): { events: BeatEvent[]; bpm: number } {
  /** Spotify Audio Features tempo (filled by Tauri); fallback only if unavailable. */
  const bpm = track.bpm ?? 120;
  const beatMs = 60_000 / bpm;
  /**
   * Demo generator fallback: many tracks have a short intro before the first strong beat.
   * Biasing phase forward avoids the common "chart trails the heard beat by ~2s" feel
   * until real beat/downbeat analysis replaces this synthetic grid path.
   */
  const phase = 2000;
  const eighth = beatMs / 2;
  const sixteenth = beatMs / 4;

  const byTime = new Map<number, BeatEvent>();

  const add = (
    timeMs: number,
    confidence: number,
    role: { beat: boolean; onset: boolean }
  ): void => {
    const k = Math.round(timeMs);
    if (k < 0 || k >= track.durationMs) return;
    const prev = byTime.get(k);
    if (!prev || confidence > prev.confidence) {
      byTime.set(k, {
        timeMs: k,
        confidence,
        isBeat: role.beat,
        isOnset: role.onset,
      });
    }
  };

  /** Quarter-note pulse — defines the beat grid / time signature feel for the generator. */
  for (let t = phase; t < track.durationMs; t += beatMs) {
    add(t, 0.94, { beat: true, onset: true });
  }
  /** Eighth / sixteenth — onsets only; per-beat onset counts become 2–4+ for density & chords. */
  for (let t = phase; t < track.durationMs; t += eighth) {
    add(t, 0.71, { beat: false, onset: true });
  }
  let sixIdx = 0;
  for (let t = phase; t < track.durationMs; t += sixteenth, sixIdx++) {
    if (sixIdx % 2 === 1) continue;
    add(t, 0.34, { beat: false, onset: true });
  }

  const events = [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
  /**
   * Demo-only melodic features so the chart generator can exercise pitch / flux paths before
   * the real analysis pipeline supplies `pitchHz` + `spectralFlux` per onset.
   */
  const a4 = 440;
  const withFeatures = events.map((e) => {
    const stepIdx = Math.floor(e.timeMs / Math.max(35, sixteenth * 0.2));
    const semi = ((stepIdx % 19) - 9) * 0.85;
    const pitchHz = a4 * 2 ** (semi / 12);
    const spectralFlux = e.isBeat
      ? 0.58 + 0.25 * (e.confidence - 0.5)
      : 0.12 + 0.55 * Math.abs(Math.sin(e.timeMs / 180));
    return {
      ...e,
      pitchHz,
      spectralFlux: Math.min(1, Math.max(0.04, spectralFlux)),
    };
  });
  return { events: withFeatures, bpm };
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
    useGameStore.setState({ trackLifecycle: "generating" });

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
