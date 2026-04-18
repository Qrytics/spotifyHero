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
 */
export function useSpotifySync(poller?: SpotifyPoller): void {
  const setPlayback = useGameStore((s) => s.setPlayback);
  const correctorRef = useRef(new DriftCorrector());

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
      setPlayback({ ...state, positionMs: correctedPos });
    });

    p.start();
    return () => p.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
