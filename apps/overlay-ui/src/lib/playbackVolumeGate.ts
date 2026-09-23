import type { PlaybackState } from "@spotifyhero/shared-types";

/**
 * Spotify reports 0–100 on the active device. Below this, we treat output as effectively silent:
 * hide notes and pause scoring even though `is_playing` may still be true.
 */
export const MIN_VOLUME_PERCENT_FOR_CHART = 5;

/**
 * True when playback is active but device volume is known and below {@link MIN_VOLUME_PERCENT_FOR_CHART}.
 * Unknown/missing volume is treated as audible so we do not regress when the API omits it.
 *
 * Spotify-only, as the name says. A low volume there means *someone else's* mixer
 * moved and the player probably cannot hear the song; on a server track the volume
 * is our own slider, and turning the music down is a legitimate way to play — it
 * must not blank the highway.
 *
 * Must stay a pure function of `PlaybackState`: `packages/note-highway` keeps a
 * second copy of this file and cannot reach the playback-source registry.
 */
export function isSpotifyPlaybackTooQuietForNotes(
  playback: PlaybackState | null | undefined
): boolean {
  if (!playback?.isPlaying) return false;
  if (playback.source === "server") return false;
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
