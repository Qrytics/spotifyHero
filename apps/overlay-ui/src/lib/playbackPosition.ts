import { playbackClock } from "./playbackClock.js";
import { useGameStore } from "../store/gameStore.js";

/** Playhead used for scoring and note highway — includes user calibration offset. */
export function calibratedPlaybackMs(): number {
  return (
    playbackClock.estimateMs() +
    useGameStore.getState().settings.playbackTimingOffsetMs
  );
}
