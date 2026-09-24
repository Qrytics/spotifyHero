/**
 * The 3 · 2 · 1 · GO! count-in that opens a music-server round.
 *
 * Three things have to agree, so they all hang off one scheduled instant — the
 * `AudioContext` time the first audio sample will be heard:
 *
 *  1. **Audio** — `playWithCountIn` schedules the track that far ahead and
 *     anchors the exact clock to it, so the playhead counts up through negative
 *     values. That is what gives the player breathing room: the opening notes
 *     scroll in from the top edge instead of appearing on the receptors.
 *  2. **Clicks** — scheduled on the audio graph (`scheduleCountInClicks`), so
 *     they cannot drift from the downbeat even if the main thread stalls.
 *  3. **Digits** — pulsed from the playhead itself (below), which means the
 *     number on screen and the stick you hear are the same clock, not two timers.
 *
 * Spotify has no count-in and cannot have one: the song is already playing on
 * someone else's device by the time a chart exists. `runCountIn` returns `false`
 * there, and the caller just plays.
 *
 * `useGameLoop` already knew how to wait — `trackLifecycle: "countdown"` +
 * `countdownUntilMs` hold scoring off until the music starts.
 */
import { useGameStore } from "../store/gameStore.js";
import {
  activePlaybackClock,
  activePlaybackSource,
  serverPlaybackSource,
} from "./playback/activeSource.js";
import type { NavidromePlaybackSource } from "./playback/NavidromePlaybackSource.js";
import { scheduleCountInClicks } from "./hitSound.js";
import { pulseScreen } from "./screenPulse.js";

/** Clicks before the downbeat: "3", "2", "1" (the 4th lands on "GO!"). */
export const COUNT_IN_BEATS = 3;
/** One second per beat — read as a count, not as the song's tempo. */
export const COUNT_IN_BEAT_MS = 1000;
export const COUNT_IN_MS = COUNT_IN_BEATS * COUNT_IN_BEAT_MS;

/**
 * Safety net for the digit loop: if the audio clock never reaches zero (a
 * suspended context, a source torn down between frames) stop pulsing rather
 * than spin for the rest of the session.
 */
const DIGIT_LOOP_TIMEOUT_MS = COUNT_IN_MS + 2000;

let digitRaf = 0;
/** Bumped per run so a superseded digit loop exits instead of fighting the new one. */
let runSeq = 0;

/** The live source, when it is the one that can count in. */
function liveServerSource(): NavidromePlaybackSource | null {
  const server = serverPlaybackSource();
  return activePlaybackSource() === server ? server : null;
}

/**
 * True when the next play of the live source would open with a count-in.
 *
 * `ScreenPulse` asks before pulsing its mode word on chart mount: the count-in
 * owns the middle of the screen at song start, and "AUTO" flashing under "3"
 * would just be noise.
 */
export function countInPending(): boolean {
  return liveServerSource()?.canCountIn() ?? false;
}

/**
 * Opens a round with the count-in. Returns `false` when this is not a
 * from-the-top start of a server track, and the caller should just `play()`.
 */
export async function runCountIn(): Promise<boolean> {
  const source = liveServerSource();
  if (!source?.canCountIn()) return false;

  const started = await source.playWithCountIn(COUNT_IN_MS);
  if (!started) return false;

  runSeq += 1;
  // Remaining time read off the audio clock rather than assumed to be
  // `COUNT_IN_MS`: scheduling and the `resumeAudioContext()` await both take
  // real time, and the game loop should start judging when the playhead crosses
  // zero — not a few ms after the first note was already audible.
  const remainingMs = Math.max(0, -activePlaybackClock().estimateMs());
  useGameStore.setState({
    trackLifecycle: "countdown",
    countdownUntilMs: Date.now() + remainingMs,
  });
  scheduleCountInClicks(started.startsAtCtxTime, COUNT_IN_BEATS, COUNT_IN_BEAT_MS);
  driveDigits(runSeq);
  return true;
}

/**
 * Starts the live source, counting in first when this is a start from the top.
 *
 * The single entry point for "begin playing" — both the phase effect in
 * `useActivePlaybackSource` and the transport's play button go through here, so
 * neither can start a song cold while the other counts in.
 */
export async function playWithOptionalCountIn(): Promise<void> {
  if (await runCountIn()) return;
  await activePlaybackSource()?.play();
}

/** Pulses 3 → 2 → 1 → GO! off the playhead, one pulse per boundary crossed. */
function driveDigits(seq: number): void {
  if (digitRaf !== 0) cancelAnimationFrame(digitRaf);
  const startedAtPerf = performance.now();
  let lastDigit = Number.POSITIVE_INFINITY;

  const tick = (): void => {
    if (seq !== runSeq) {
      digitRaf = 0;
      return;
    }

    // Pausing or leaving mid-count abandons the count silently, and clears the
    // lifecycle it set so a later resume is not left waiting on a dead deadline.
    const { phase, trackLifecycle } = useGameStore.getState();
    const aborted =
      (phase !== "autoplay" && phase !== "manual") ||
      performance.now() - startedAtPerf > DIGIT_LOOP_TIMEOUT_MS;
    if (aborted) {
      digitRaf = 0;
      if (trackLifecycle === "countdown") {
        useGameStore.setState({
          trackLifecycle: "playing",
          countdownUntilMs: null,
        });
      }
      return;
    }

    // The raw clock, not `calibratedPlaybackMs()`: the digits belong with the
    // clicks, which are scheduled on the audio graph and know nothing of the
    // player's hit-timing offset.
    const positionMs = activePlaybackClock().estimateMs();
    if (positionMs >= 0) {
      digitRaf = 0;
      pulseScreen({ text: "GO!", tone: "accent", size: "xl" });
      return;
    }

    const digit = Math.ceil(-positionMs / COUNT_IN_BEAT_MS);
    if (digit < lastDigit) {
      lastDigit = digit;
      pulseScreen({ text: String(digit), size: "xl" });
    }
    digitRaf = requestAnimationFrame(tick);
  };

  digitRaf = requestAnimationFrame(tick);
}
