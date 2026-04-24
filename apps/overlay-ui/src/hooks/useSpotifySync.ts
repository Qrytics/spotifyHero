import { useEffect, useRef } from "react";
import { useGameStore } from "../store/gameStore.js";
import { DriftCorrector, MockSpotifyPoller } from "@spotifyhero/audio-engine";
import type { SpotifyPoller } from "@spotifyhero/audio-engine";
import { TauriSpotifyPoller } from "../lib/TauriSpotifyPoller.js";
import { playbackClock } from "../lib/playbackClock.js";
import { pauseSpotifyPlayback } from "../lib/spotifyControl.js";

type WindowWithMockPoller = Window & { __mockPoller?: MockSpotifyPoller };

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Desktop: poll infrequently — playback position is smoothed via `playbackClock`; only need timely pause/track changes. */
const TAURI_POLL_MS = 2800;
const HEARTBEAT_PUSH_MS = 9000;
const SEEK_DISCONTINUITY_MS = 2800;
const HEARTBEAT_SYNC_DRIFT_MS = 85;

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
      volumePercent: null,
    },
    500
  );
}

/**
 * useSpotifySync
 *
 * Manages the Spotify playback polling loop and drift correction.
 *
 * **Inputs:**
 *   - `poller` (optional) — a `SpotifyPoller` instance; auto-created if omitted.
 *     In the Tauri desktop shell, uses `TauriSpotifyPoller` (native IPC).
 *     In the browser dev server, uses `MockSpotifyPoller` (accessible via
 *     `window.__mockPoller` for manual testing).
 *
 * **Outputs (dispatched to game store):**
 *   - `setPlayback(state)` — called every poll cycle with the latest playback state
 *
 * **Side effects:**
 *   - Syncs `playbackClock` so the highway render loop can extrapolate position
 *     between polls without snapping.
 *   - Calls `pauseSpotifyPlayback()` via Tauri IPC when the game requests a pause.
 *
 * **Mockable:** Pass a custom `SpotifyPoller` implementation to override default
 * polling behaviour in tests or alternative environments.
 */
export function useSpotifySync(poller?: SpotifyPoller): void {
  const correctorRef = useRef(new DriftCorrector());
  const lastAppliedRef = useRef<{
    isPlaying: boolean;
    positionMs: number;
    trackId: string | null;
    emittedAtMs: number;
  } | null>(null);

  useEffect(() => {
    const p: SpotifyPoller = poller ?? createDefaultPoller();

    p.onStateChange((state) => {
      const nowMs = Date.now();
      const prev = lastAppliedRef.current;
      const trackChanged = !prev || prev.trackId !== state.trackId;
      const playToggled = !prev || prev.isPlaying !== state.isPlaying;
      const largeSeek =
        !prev || Math.abs(state.positionMs - prev.positionMs) >= SEEK_DISCONTINUITY_MS;
      const heartbeatDue =
        !prev || nowMs - prev.emittedAtMs >= HEARTBEAT_PUSH_MS;
      const shouldApply = trackChanged || playToggled || largeSeek || heartbeatDue;
      if (!shouldApply) return;

      if (trackChanged) {
        correctorRef.current.reset();
        void pauseSpotifyPlayback();
      }

      const heartbeatOnly =
        heartbeatDue && !trackChanged && !playToggled && !largeSeek;

      let correctedPos = state.positionMs;
      if (!heartbeatOnly) {
        correctorRef.current.update(state.positionMs);
        correctedPos = correctorRef.current.correct(state.positionMs);
      }

      if (
        heartbeatOnly &&
        Math.abs(correctedPos - playbackClock.estimateMs()) < HEARTBEAT_SYNC_DRIFT_MS
      ) {
        lastAppliedRef.current = {
          isPlaying: state.isPlaying,
          positionMs: correctedPos,
          trackId: state.trackId,
          emittedAtMs: nowMs,
        };
        return;
      }

      playbackClock.sync(correctedPos, state.isPlaying, state.trackId);
      const next = { ...state, positionMs: correctedPos };
      useGameStore.getState().setPlayback(next);
      lastAppliedRef.current = {
        isPlaying: next.isPlaying,
        positionMs: next.positionMs,
        trackId: next.trackId,
        emittedAtMs: nowMs,
      };
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
