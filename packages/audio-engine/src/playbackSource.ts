/**
 * The contract every music source implements, so gameplay never asks
 * "are we on Spotify or the server?".
 *
 * Two shapes live here:
 *
 *  - `PlaybackClock` — the playhead. A **discriminated union on `isExact`**,
 *    not an interface with an optional `sync?`. That matters under
 *    `exactOptionalPropertyTypes`: `if (clock.isExact) return;` narrows the
 *    remaining branch to `ExtrapolatedPlaybackClock` with no cast, which is how
 *    `useGameLoop` guards all four of its `sync()` call sites at once.
 *
 *  - `PlaybackSource` — clock + transport + capabilities in **one** object.
 *    Deliberately not split into a clock registry and a transport registry:
 *    two registries can disagree about which mode is live.
 *
 * Nothing here touches the DOM or Web Audio; the implementations live in
 * `apps/overlay-ui/src/lib/playback/`.
 */

import type { PlaybackState } from "@spotifyhero/shared-types";

/**
 * A playhead derived from the audio hardware itself — sample-accurate, needs no
 * correction from outside. `NavidromePlaybackSource` (Web Audio) provides this.
 */
export interface ExactPlaybackClock {
  readonly isExact: true;
  /** Current playback position in ms. Safe to call from rAF. */
  estimateMs(): number;
  reset(): void;
}

/**
 * A playhead reconstructed between sparse position reports — see
 * `PlaybackClockImpl`. Whoever receives those reports must call `sync()`.
 */
export interface ExtrapolatedPlaybackClock {
  readonly isExact: false;
  /** Current playback position in ms. Safe to call from rAF. */
  estimateMs(): number;
  reset(): void;
  /** Feed a fresh position report. Never call from rAF. */
  sync(positionMs: number, isPlaying: boolean, trackId: string | null): void;
}

export type PlaybackClock = ExactPlaybackClock | ExtrapolatedPlaybackClock;

/** What a source can actually do, so the UI never offers a dead control. */
export interface PlaybackSourceCapabilities {
  /** `clock.isExact`. Mirrored here so a caller can ask before touching the clock. */
  exactClock: boolean;
  /**
   * Arbitrary seek is exposed to gameplay and UI.
   *
   * **`false` for both sources in v1** — there is no scrub bar and no practice
   * mode, so no code path may reach a position other than 0. `seek()` itself
   * still exists, but only `restart()` calls it.
   */
  seek: boolean;
  /** `setVolume()` does something. False for Spotify (it owns its own volume). */
  localVolume: boolean;
  /** The source pushes `PlaybackSourceEvent`s on its own, without being polled. */
  emitsTransportEvents: boolean;
}

/**
 * Events a source pushes out.
 *
 * There is **no `"seeked"`** variant in v1: nothing can emit one, and a dead
 * event would mean a dead branch in `useGameLoop`. Add it together with
 * practice mode, not before.
 *
 * `"restarted"` is what lets the loop reset scoring deterministically instead of
 * inferring a restart from a backward position jump.
 */
export type PlaybackSourceEvent =
  | { type: "state"; state: PlaybackState }
  | { type: "restarted" }
  | { type: "ended" };

export interface PlaybackSource {
  readonly id: "spotify" | "server";
  readonly capabilities: PlaybackSourceCapabilities;
  readonly clock: PlaybackClock;

  /** Begin observing / owning playback. Idempotent. */
  start(): void;
  /** Release timers, audio nodes and buffers. Idempotent. */
  stop(): void;

  play(): Promise<void>;
  pause(): Promise<void>;

  /**
   * Internal in v1: only ever called with `0`, by `restart()`. Not reachable
   * from the UI — see `capabilities.seek`.
   */
  seek(positionMs: number): Promise<void>;
  restart(): Promise<void>;

  /** `unit01` is 0–1. No-op when `!capabilities.localVolume`. */
  setVolume(unit01: number): Promise<void>;

  /** Subscribe; returns an unsubscribe function. */
  onEvent(cb: (ev: PlaybackSourceEvent) => void): () => void;
}
