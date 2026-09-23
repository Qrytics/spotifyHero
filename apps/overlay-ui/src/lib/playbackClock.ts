/**
 * Shim: the extrapolating playback clock now lives in
 * `@spotifyhero/audio-engine` (`extrapolatingClock.ts`), where it is unit
 * tested. This module keeps the import path stable and owns the single
 * process-wide instance used by the Spotify path.
 *
 * Edit the package, not this file, for logic changes.
 */
import { PlaybackClockImpl } from "@spotifyhero/audio-engine";

export { PlaybackClockImpl };

export const playbackClock = new PlaybackClockImpl();
