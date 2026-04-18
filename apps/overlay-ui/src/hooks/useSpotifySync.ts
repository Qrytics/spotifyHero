import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore.js";
import { DriftCorrector, MockSpotifyPoller } from "@spotifyhero/audio-engine";
import type { SpotifyPoller } from "@spotifyhero/audio-engine";
import { TauriSpotifyPoller } from "../lib/TauriSpotifyPoller.js";
import { playbackClock } from "../lib/playbackClock.js";

type WindowWithMockPoller = Window & { __mockPoller?: MockSpotifyPoller };

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Desktop: poll infrequently — playback position is smoothed via `playbackClock`; only need timely pause/track changes. */
const TAURI_POLL_MS = 2800;

function createDefaultPoller(): SpotifyPoller {
  if (isTauriRuntime()) {
    return new TauriSpotifyPoller(TAURI_POLL_MS);
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
 * In the Tauri desktop shell, uses `TauriSpotifyPoller` → `get_playback_state`
 * on a multi-second interval (pause/skip detection; timing uses `playbackClock` between polls).
 * In the browser dev server, uses `MockSpotifyPoller` (see README / `__mockPoller`).
 *
 * The effect intentionally runs only on mount (empty dep array): the poller
 * is either provided once at construction time or created once via the mock.
 * `setPlayback` is a stable Zustand action reference that never changes.
 */
export function useSpotifySync(poller?: SpotifyPoller): void {
  const correctorRef = useRef(new DriftCorrector());

  useEffect(() => {
    const p: SpotifyPoller = poller ?? createDefaultPoller();

    p.onStateChange((state) => {
      correctorRef.current.update(state.positionMs);
      const correctedPos = correctorRef.current.correct(state.positionMs);
      playbackClock.sync(correctedPos, state.isPlaying, state.trackId);
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
