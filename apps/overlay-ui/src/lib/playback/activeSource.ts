/**
 * Which music source is live, and therefore which clock and which transport the
 * rest of the app talks to.
 *
 * One registry holding one `PlaybackSource` — not a clock registry plus a
 * transport registry, which could disagree about the current mode. Same
 * dependency-inversion shape as `registerNoteHighwayPlaybackClock`: the
 * packages below `overlay-ui` stay platform-free, and this module does the
 * wiring.
 *
 * `useActivePlaybackSource` owns the registration; everything else only reads.
 */
import type { PlaybackClock, PlaybackSource } from "@spotifyhero/audio-engine";
import { playbackClock } from "../playbackClock.js";
import { NavidromePlaybackSource } from "./NavidromePlaybackSource.js";
import { SpotifyPlaybackSource } from "./SpotifyPlaybackSource.js";

let spotify: SpotifyPlaybackSource | null = null;
let server: NavidromePlaybackSource | null = null;
let active: PlaybackSource | null = null;
let restartSeq = 0;

/** Lazily created singletons: one Navidrome source means one `AudioBuffer`. */
export function spotifyPlaybackSource(): SpotifyPlaybackSource {
  const existing = spotify;
  if (existing) return existing;
  const created = new SpotifyPlaybackSource();
  spotify = created;
  return created;
}

export function serverPlaybackSource(): NavidromePlaybackSource {
  const existing = server;
  if (existing) return existing;
  const created = new NavidromePlaybackSource();
  server = created;
  return created;
}

export function activePlaybackSource(): PlaybackSource | null {
  return active;
}

export function setActivePlaybackSource(src: PlaybackSource | null): void {
  active = src;
}

/**
 * Never null, so `calibratedPlaybackMs()` needs no guard.
 *
 * Before any source registers, this is the Spotify extrapolating clock — which
 * reads `0` until `useSpotifySync` syncs it. That is exactly the pre-refactor
 * behaviour.
 */
export function activePlaybackClock(): PlaybackClock {
  return active?.clock ?? playbackClock;
}

/**
 * Monotonic counter bumped whenever the live source reports a restart.
 *
 * Phase 5 has `useGameLoop` watch this and reset scoring deterministically,
 * ahead of (and in addition to) the backward-jump heuristic that has to stay for
 * Spotify, where no restart event exists.
 */
export function playbackRestartSeq(): number {
  return restartSeq;
}

export function bumpPlaybackRestartSeq(): void {
  restartSeq += 1;
}
