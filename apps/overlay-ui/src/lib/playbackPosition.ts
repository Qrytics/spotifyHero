import { useGameStore } from "../store/gameStore.js";
import {
  activePlaybackClock,
  activePlaybackSource,
} from "./playback/activeSource.js";

/**
 * Playhead used for scoring and the note highway — the single funnel every
 * judging and drawing path reads from (`useGameLoop`, and `NoteHighway` via
 * `registerNoteHighwayPlaybackClock`).
 *
 * The offset is **per source**, not shared. `playbackTimingOffsetMs` bakes in
 * Spotify's report and anchor bias; reusing it for locally decoded audio would
 * wreck a carefully calibrated Spotify value the moment a server track plays —
 * and vice versa.
 */
export function calibratedPlaybackMs(): number {
  const settings = useGameStore.getState().settings;
  const offset =
    activePlaybackSource()?.id === "server"
      ? settings.serverPlaybackTimingOffsetMs
      : settings.playbackTimingOffsetMs;
  return activePlaybackClock().estimateMs() + offset;
}
