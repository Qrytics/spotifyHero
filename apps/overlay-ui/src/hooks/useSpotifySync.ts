import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore.js";
import { DriftCorrector, MockSpotifyPoller } from "@spotifyhero/audio-engine";
import type { SpotifyPoller } from "@spotifyhero/audio-engine";

/**
 * useSpotifySync
 *
 * Manages the Spotify playback polling loop and drift correction.
 * Drives `setPlayback` on the game store.
 *
 * In production, swap `MockSpotifyPoller` for the Tauri IPC-backed poller.
 *
 * The effect intentionally runs only on mount (empty dep array): the poller
 * is either provided once at construction time or created once via the mock.
 * `setPlayback` is a stable Zustand action reference that never changes.
 */
export function useSpotifySync(poller?: SpotifyPoller): void {
  const correctorRef = useRef(new DriftCorrector());
  // Capture a stable ref to the store action so the effect closure stays valid
  // without needing to re-register the polling handler on every render.
  const setPlaybackRef = useRef(useGameStore.getState().setPlayback);

  useEffect(() => {
    const p: SpotifyPoller =
      poller ??
      new MockSpotifyPoller(
        {
          isPlaying: false,
          positionMs: 0,
          trackId: null,
          track: null,
        },
        500
      );

    p.onStateChange((state) => {
      correctorRef.current.update(state.positionMs);
      const correctedPos = correctorRef.current.correct(state.positionMs);
      // Always read the latest action from the store to avoid stale closures
      useGameStore.getState().setPlayback({ ...state, positionMs: correctedPos });
    });

    p.start();
    return () => p.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty: poller identity is stable after mount
}
