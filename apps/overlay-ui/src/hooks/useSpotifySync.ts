import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore.js";
import { DriftCorrector, MockSpotifyPoller } from "@spotifyhero/audio-engine";
import type { SpotifyPoller } from "@spotifyhero/audio-engine";
import { TauriSpotifyPoller } from "../lib/TauriSpotifyPoller.js";

type WindowWithMockPoller = Window & { __mockPoller?: MockSpotifyPoller };

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function createDefaultPoller(): SpotifyPoller {
  if (isTauriRuntime()) {
    return new TauriSpotifyPoller(750);
  }
  return new MockSpotifyPoller(
    {
      isPlaying: false,
      positionMs: 0,
      trackId: null,
      track: null,
    },
    500
  );
}

/**
 * useSpotifySync
 *
 * Manages the Spotify playback polling loop and drift correction.
 * Drives `setPlayback` on the game store.
 *
 * In the Tauri desktop shell, uses `TauriSpotifyPoller` → `get_playback_state`.
 * In the browser dev server, uses `MockSpotifyPoller` (see README / `__mockPoller`).
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
    const p: SpotifyPoller = poller ?? createDefaultPoller();

    p.onStateChange((state) => {
      correctorRef.current.update(state.positionMs);
      const correctedPos = correctorRef.current.correct(state.positionMs);
      // Always read the latest action from the store to avoid stale closures
      useGameStore.getState().setPlayback({ ...state, positionMs: correctedPos });
    });

    if (p instanceof MockSpotifyPoller) {
      (window as WindowWithMockPoller).__mockPoller = p;
    }

    p.start();
    return () => {
      if (p instanceof MockSpotifyPoller) {
        const w = window as WindowWithMockPoller;
        if (w.__mockPoller === p) {
          delete w.__mockPoller;
        }
      }
      p.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty: poller identity is stable after mount
}
