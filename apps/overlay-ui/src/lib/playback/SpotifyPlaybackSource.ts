/**
 * `PlaybackSource` for Spotify — a **façade over the code that already exists**,
 * not a rewrite.
 *
 * `useSpotifySync` keeps owning the poller, keeps calling `playbackClock.sync()`
 * and `setPlayback()` exactly as before. This wrapper only exists so
 * `calibratedPlaybackMs()` and `useGameLoop` can ask "which clock, which
 * transport?" without branching on `settings.musicSource`. The abstraction is
 * only as deep as music-server mode requires — going deeper would mean moving
 * the hard-won poll-filtering logic, for no benefit.
 *
 * Consequences of that shallowness, all deliberate:
 *   - `start()` / `stop()` are no-ops; the hook's `useEffect` is the lifecycle.
 *   - `onEvent` never fires (`emitsTransportEvents: false`); the store is still
 *     the channel through which playback state reaches gameplay.
 *   - `seek` / `restart` are no-ops: there is no `spotify_seek` IPC command, and
 *     restart-from-the-top is Mode 1's feature. Backward-jump detection in
 *     `useGameLoop` remains how a Spotify restart is noticed.
 */
import type {
  ExtrapolatedPlaybackClock,
  PlaybackSource,
  PlaybackSourceCapabilities,
  PlaybackSourceEvent,
} from "@spotifyhero/audio-engine";
import { playbackClock } from "../playbackClock.js";
import {
  pauseSpotifyPlayback,
  resumeSpotifyPlayback,
} from "../spotifyControl.js";

const CAPABILITIES: PlaybackSourceCapabilities = {
  exactClock: false,
  seek: false,
  /** Spotify owns its own volume; the game must not fight the user's mixer. */
  localVolume: false,
  emitsTransportEvents: false,
};

export class SpotifyPlaybackSource implements PlaybackSource {
  readonly id = "spotify" as const;
  readonly capabilities = CAPABILITIES;
  /** The process-wide extrapolating clock `useSpotifySync` already syncs. */
  readonly clock: ExtrapolatedPlaybackClock = playbackClock;

  start(): void {
    /* `useSpotifySync` owns the poller. */
  }

  stop(): void {
    /* `useSpotifySync` owns the poller. */
  }

  async play(): Promise<void> {
    await resumeSpotifyPlayback();
  }

  async pause(): Promise<void> {
    await pauseSpotifyPlayback();
  }

  async seek(_positionMs: number): Promise<void> {
    /* Unsupported: no `spotify_seek` IPC command exists. */
  }

  async restart(): Promise<void> {
    /* Unsupported — see `seek`. */
  }

  async setVolume(_unit01: number): Promise<void> {
    /* `localVolume: false`. */
  }

  onEvent(_cb: (ev: PlaybackSourceEvent) => void): () => void {
    // Nothing emits; playback state reaches gameplay through the store.
    return () => {};
  }
}
