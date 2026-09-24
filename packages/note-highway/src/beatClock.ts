/**
 * Beat grid, derived from the chart — not from the wall clock.
 *
 * Everything that pulses on the beat reads from here, and every beat position is
 * turned into a Y by the *same* `yFromTime` the notes use. That is why the grid
 * cannot drift against the notes: it is the same function of the same playhead.
 * (The old speed lines scrolled off `performance.now()` and visibly drifted.)
 *
 * Caveat on the Spotify path: `chart.bpm` is Spotify's *average* tempo, so on a
 * tempo-varying song the grid drifts from the audio even though it stays locked
 * to the notes. It is kept subtle for exactly that reason.
 */

/** Fallback when a chart reports a nonsense BPM — 120bpm. */
export const FALLBACK_BEAT_MS = 500;

export function beatPeriodMs(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return FALLBACK_BEAT_MS;
  const ms = 60000 / bpm;
  // A 6000ms "beat" (10bpm) or a 60ms one is not a usable visual grid.
  if (!Number.isFinite(ms) || ms < 80 || ms > 3000) return FALLBACK_BEAT_MS;
  return ms;
}

/**
 * Phase offset of the grid, taken from the first note rather than from t=0.
 *
 * The Spotify path synthesizes its beat grid with a 2000ms phase bias, so a raw
 * `positionMs % beatMs` would not land on the notes. `Chart` has no phase field,
 * so the first note head is the best available anchor — and on both paths the
 * first note *is* on the grid.
 */
export function beatAnchorMs(firstNoteHeadMs: number, beatMs: number): number {
  if (!Number.isFinite(firstNoteHeadMs) || beatMs <= 0) return 0;
  return ((firstNoteHeadMs % beatMs) + beatMs) % beatMs;
}

/** 0 exactly on a beat, rising to just under 1 before the next. */
export function beatPhase01(positionMs: number, beatMs: number, anchorMs: number): number {
  if (beatMs <= 0) return 0;
  const rel = positionMs - anchorMs;
  return (((rel % beatMs) + beatMs) % beatMs) / beatMs;
}

/** Sharp attack-decay from 1 on the beat to 0 just before the next. */
export function beatPulse01(phase01: number): number {
  const p = Math.max(0, Math.min(1, phase01));
  return (1 - p) ** 3;
}

/** Absolute playback time of beat `index` (index 0 is the beat at the anchor). */
export function beatTimeAt(index: number, beatMs: number, anchorMs: number): number {
  return anchorMs + index * beatMs;
}

/** Lowest beat index whose time is >= `timeMs`. */
export function beatIndexAtOrAfter(timeMs: number, beatMs: number, anchorMs: number): number {
  if (beatMs <= 0) return 0;
  return Math.ceil((timeMs - anchorMs) / beatMs);
}
