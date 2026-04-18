import type { PlaybackState } from "@spotifyhero/shared-types";

/**
 * Spotify reports 0–100 on the active device. Below this, we treat output as effectively silent:
 * hide notes and pause scoring even though `is_playing` may still be true.
 */
export const MIN_VOLUME_PERCENT_FOR_CHART = 5;

/**
 * True when playback is active but device volume is known and below {@link MIN_VOLUME_PERCENT_FOR_CHART}.
 * Unknown/missing volume is treated as audible so we do not regress when the API omits it.
 */
export function isSpotifyPlaybackTooQuietForNotes(
  playback: PlaybackState | null | undefined
): boolean {
  if (!playback?.isPlaying) return false;
  const v = playback.volumePercent;
  if (v === undefined || v === null) return false;
  return v < MIN_VOLUME_PERCENT_FOR_CHART;
}

/**
 * Hide the highway and pause scoring when the device is effectively silent.
 * Autoplay bypasses this: the chart should keep running visually and in the scorer so sustains
 * do not flicker out when Spotify's volume poll is low or missing intermittently.
 */
export function shouldHideNotesForQuietPlayback(
  playback: PlaybackState | null | undefined,
  phase: string
): boolean {
  if (phase === "autoplay") return false;
  return isSpotifyPlaybackTooQuietForNotes(playback);
}
