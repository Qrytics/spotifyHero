import type { Difficulty } from "@spotifyhero/shared-types";

/**
 * Note scroll speed each difficulty starts at.
 *
 * A harder chart puts more notes in the same minute, so at one fixed speed the
 * higher difficulties read as cramped — two notes 150 ms apart are 150 ms apart
 * on screen no matter how good you are. The fix is more pixels per second, not a
 * thinner chart: `noteScrollSpeed` divides the highway's 2200 ms look-ahead
 * (`LOOK_AHEAD_MS / speed` in `NoteHighway`), so 1.3 is ~1.7 s of visible
 * approach and 2.1 is ~1.05 s.
 *
 * `updateSettings` applies these on every difficulty change, deliberately over a
 * speed the player set by hand: it is a per-difficulty starting point, and the
 * up/down arrows re-tune it in one keypress.
 */
export const DIFFICULTY_SCROLL_SPEED: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.3,
  hard: 1.7,
  expert: 2.1,
};

/** `AppSettingsSchema` bounds, for anything that nudges the speed. */
export const MIN_SCROLL_SPEED = 0.45;
export const MAX_SCROLL_SPEED = 5;

/** One arrow-key press. Kept coarse enough to feel the change in one tap. */
export const SCROLL_SPEED_STEP = 0.1;

/** Clamped and rounded to one decimal, so repeated steps cannot drift on floats. */
export function stepScrollSpeed(current: number, direction: -1 | 1): number {
  const next = Math.round((current + direction * SCROLL_SPEED_STEP) * 10) / 10;
  return Math.min(MAX_SCROLL_SPEED, Math.max(MIN_SCROLL_SPEED, next));
}
