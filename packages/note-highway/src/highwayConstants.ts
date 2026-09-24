/**
 * Highway timing / layout constants.
 *
 * These govern **feel**, not just looks — `LOOK_AHEAD_MS` in particular defines
 * the px/ms scroll rate every theme draws with. Changing it changes how early a
 * note becomes visible, which changes how players read the chart. Treat as frozen.
 */

export const LANE_COUNT = 4;

/** Pixels between canvas bottom and bottom of target rings — “almost touching”. */
export const HIT_LINE_BOTTOM_PAD = 4;

export const LOOK_BACK_MS = 400;

/** Time span from hit line to top edge (y=0); scroll speed is hitLineY / LOOK_AHEAD_MS px/ms. */
export const LOOK_AHEAD_MS = 2200;

/**
 * Include notes farther in the future so they render above the canvas top and scroll into view.
 * Without this, the first frame for a note has cy === 0 (pop at top edge).
 */
export const SCROLL_IN_ABOVE_MS = 380;

/**
 * Extra lookahead so a forward jump in playhead (drift re-anchor after ~135ms threshold, seek,
 * or a long rAF gap) does not move an off-screen note into visible space in one step.
 */
export const SCROLL_IN_STUTTER_MS = 400;

export const SCROLL_IN_EXTRA_MS = SCROLL_IN_ABOVE_MS + SCROLL_IN_STUTTER_MS;

export const PLAYABLE_PHASES: ReadonlySet<string> = new Set([
  "autoplay",
  "manual",
  "paused",
]);

export const HIT_FX_MS = 480;
export const HIT_RING_EXPANSION = 14;

/** Past this Y (CSS px) the note is considered off-screen downward. */
export const OFF_SCREEN_BOTTOM_PAD = 24;

/** Small temporal epsilon to avoid precision edge-cases around sustain tails. */
export const TIME_EPSILON_MS = 0.01;

/** Large backward playhead jump likely means seek/replay; clear visual state. */
export const VISUAL_RESET_BACKWARD_JUMP_MS = 3000;

/** Sustain strip shorter than this (px) is treated as fully collapsed. */
export const SUSTAIN_MIN_HEIGHT_PX = 0.75;
