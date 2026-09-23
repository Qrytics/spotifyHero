import { describe, expect, it } from "vitest";
import type { PlaybackState } from "@spotifyhero/shared-types";
import {
  MIN_VOLUME_PERCENT_FOR_CHART,
  isSpotifyPlaybackTooQuietForNotes,
  shouldHideNotesForQuietPlayback,
} from "./playbackVolumeGate.js";

function state(patch: Partial<PlaybackState>): PlaybackState {
  return {
    isPlaying: true,
    positionMs: 1000,
    trackId: "t1",
    track: null,
    volumePercent: 80,
    ...patch,
  };
}

describe("isSpotifyPlaybackTooQuietForNotes", () => {
  it("is quiet below the threshold on Spotify", () => {
    expect(
      isSpotifyPlaybackTooQuietForNotes(
        state({ volumePercent: MIN_VOLUME_PERCENT_FOR_CHART - 1 })
      )
    ).toBe(true);
  });

  it("is audible at the threshold", () => {
    expect(
      isSpotifyPlaybackTooQuietForNotes(
        state({ volumePercent: MIN_VOLUME_PERCENT_FOR_CHART })
      )
    ).toBe(false);
  });

  it("treats unknown volume as audible", () => {
    expect(isSpotifyPlaybackTooQuietForNotes(state({ volumePercent: null }))).toBe(false);
  });

  it("is never quiet while paused", () => {
    expect(
      isSpotifyPlaybackTooQuietForNotes(state({ isPlaying: false, volumePercent: 0 }))
    ).toBe(false);
  });

  it("treats undefined source as spotify", () => {
    // `PlaybackState.source` is optional and absent on every pre-existing
    // Spotify state, so the gate has to keep working without it.
    const pb = state({ volumePercent: 0 });
    delete (pb as { source?: string }).source;
    expect(isSpotifyPlaybackTooQuietForNotes(pb)).toBe(true);
  });

  // The regression this guard exists for: the server volume slider is the
  // player's own, and dragging it to 0 used to blank the highway.
  it("ignores volume entirely on a server track", () => {
    expect(
      isSpotifyPlaybackTooQuietForNotes(state({ source: "server", volumePercent: 0 }))
    ).toBe(false);
  });

  it("does not hide notes for a silent server track", () => {
    expect(
      shouldHideNotesForQuietPlayback(
        state({ source: "server", volumePercent: 0 }),
        "manual"
      )
    ).toBe(false);
  });

  it("still hides notes for a silent Spotify device in manual", () => {
    expect(shouldHideNotesForQuietPlayback(state({ volumePercent: 0 }), "manual")).toBe(
      true
    );
  });

  it("autoplay bypasses the gate", () => {
    expect(shouldHideNotesForQuietPlayback(state({ volumePercent: 0 }), "autoplay")).toBe(
      false
    );
  });
});
