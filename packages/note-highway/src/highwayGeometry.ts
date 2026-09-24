import { HIT_LINE_BOTTOM_PAD, LANE_COUNT, OFF_SCREEN_BOTTOM_PAD } from "./highwayConstants.js";

/**
 * Highway geometry — **frozen**.
 *
 * `hitLineYFromHeight` is where every existing user's `playbackTimingOffsetMs`
 * was calibrated. Moving it by even a few pixels silently invalidates their
 * calibration and changes hit feel, so no theme may override any of this.
 * A theme that wants “bigger gems” scales its sprite, never the radius.
 */

export function noteRadiusFromViewport(width: number, height: number): number {
  const laneWidth = width / LANE_COUNT;
  void height;
  const byLane = laneWidth * 0.18;
  return Math.min(30, Math.max(12, byLane));
}

/** Vertical center of hit line / receptors — bottom of outer target ring sits `HIT_LINE_BOTTOM_PAD` px above canvas bottom. */
export function hitLineYFromHeight(height: number, noteRadius: number): number {
  return height - (noteRadius + 5) - HIT_LINE_BOTTOM_PAD;
}

export function yFromTime(
  hitLineY: number,
  pxPerMs: number,
  noteTimeMs: number,
  positionMs: number
): number {
  const dt = noteTimeMs - positionMs;
  return hitLineY - dt * pxPerMs;
}

/** Sustain strip stays until the tail scrolls past the bottom edge (not a fixed ms after note end). */
export function isSustainTailPastCanvasBottom(
  hitLineY: number,
  pxPerMs: number,
  tailTimeMs: number,
  positionMs: number,
  height: number
): boolean {
  const cyTail = yFromTime(hitLineY, pxPerMs, tailTimeMs, positionMs);
  return cyTail > height + OFF_SCREEN_BOTTOM_PAD;
}

/**
 * Everything a theme needs to know about the current frame. One mutable struct
 * per mount, overwritten in place each frame — never allocated inside the loop.
 */
export type HighwayFrame = {
  w: number;
  h: number;
  dpr: number;
  laneWidth: number;
  noteRadius: number;
  hitLineY: number;
  pxPerMs: number;
  /** Visual playhead (calibrated clock + visualNoteOffsetMs). */
  positionMs: number;
  /** `performance.now()` — fx ages only. Never used for anything the notes move with. */
  nowMs: number;
  /** Effective lookahead after `noteScrollSpeed`. */
  lookAheadMs: number;
  beatMs: number;
  beatAnchorMs: number;
  /** 0 at a beat, → 1 just before the next. */
  beatPhase01: number;
  /** Sharp decay from 1 on the beat to 0 — `(1 - phase)^3`. */
  beatPulse01: number;
  combo: number;
  reducedMotion: boolean;
};

export function createHighwayFrame(): HighwayFrame {
  return {
    w: 0,
    h: 0,
    dpr: 1,
    laneWidth: 0,
    noteRadius: 12,
    hitLineY: 0,
    pxPerMs: 0,
    positionMs: 0,
    nowMs: 0,
    lookAheadMs: 2200,
    beatMs: 500,
    beatAnchorMs: 0,
    beatPhase01: 0,
    beatPulse01: 0,
    combo: 0,
    reducedMotion: false,
  };
}

export function laneCenterX(lane: number, laneWidth: number): number {
  return lane * laneWidth + laneWidth / 2;
}
