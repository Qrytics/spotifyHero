/**
 * Registers the live `PlaybackSource` for the selected music source, pumps its
 * events into the game store, and starts audio at the right moment.
 *
 * **Mount this first in `App.tsx`**, ahead of `useSpotifySync` /
 * `useChartGeneration` / `useGameLoop`, so the registry is populated before
 * anything reads `activePlaybackClock()`.
 *
 * Spotify is the degenerate case: its source is a façade, `onEvent` never fires,
 * and `useSpotifySync` keeps calling `setPlayback()` itself. Nothing about the
 * Spotify path changes here.
 */
import { useEffect } from "react";
import { useGameStore } from "../store/gameStore.js";
import {
  activePlaybackSource,
  bumpPlaybackRestartSeq,
  serverPlaybackSource,
  setActivePlaybackSource,
  spotifyPlaybackSource,
} from "../lib/playback/activeSource.js";
import type { NavidromePlaybackSource } from "../lib/playback/NavidromePlaybackSource.js";
import { clearPreparedAudio } from "../lib/analysis/preparedAudio.js";

type WindowWithServerSource = Window & {
  __serverSource?: NavidromePlaybackSource;
};

export function useActivePlaybackSource(): void {
  const musicSource = useGameStore((s) => s.settings.musicSource);
  const phase = useGameStore((s) => s.phase);

  useEffect(() => {
    const src =
      musicSource === "server" ? serverPlaybackSource() : spotifyPlaybackSource();
    setActivePlaybackSource(src);
    src.start();

    const unsubscribe = src.onEvent((ev) => {
      switch (ev.type) {
        case "state":
          useGameStore.getState().setPlayback(ev.state);
          break;
        case "restarted":
          bumpPlaybackRestartSeq();
          break;
        case "ended":
          // Nothing to do: the game loop already ends a round from
          // `chartEndPlaybackMs` + all-notes-resolved. Phase 5 shortens the
          // stale-frame wait for exact clocks, which is the real fix.
          break;
      }
    });

    // Same escape hatch as `window.__mockPoller`: lets the transport and the
    // exact clock be driven from the console before the chart pipeline exists.
    //   __serverSource.play() / .pause() / .restart() / .setVolume(0.4)
    if (import.meta.env.DEV) {
      (window as WindowWithServerSource).__serverSource = serverPlaybackSource();
    }

    return () => {
      unsubscribe();
      // Leaving server mode must release the ~92 MB `AudioBuffer` and silence
      // the node. `SpotifyPlaybackSource.stop()` is a no-op, so this is safe
      // for both. Both holders have to let go: `stop()` drops the source's
      // reference, `clearPreparedAudio()` drops the analysis registry's.
      src.stop();
      clearPreparedAudio();
      if (activePlaybackSource() === src) setActivePlaybackSource(null);
      if (import.meta.env.DEV) {
        delete (window as WindowWithServerSource).__serverSource;
      }
    };
  }, [musicSource]);

  /**
   * The contract: `prepare()` decodes but does **not** start audio. Playback
   * begins when the chart has landed and the store has moved into a play phase —
   * otherwise the song would play under the "Generating chart…" screen.
   *
   * `play()` returns early when already playing, so the autoplay ↔ manual toggle
   * and a resume-from-pause both land here harmlessly.
   */
  useEffect(() => {
    if (phase !== "autoplay" && phase !== "manual") return;
    const src = activePlaybackSource();
    if (!src || src.id !== "server") return;
    void src.play();
  }, [phase]);
}
