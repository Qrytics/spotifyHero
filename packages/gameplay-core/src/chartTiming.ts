import type { Chart, Note } from "@spotifyhero/shared-types";

/**
 * Ms after song start before any chart note is judged or drawn.
 * Matches Spotify wall time — first notes hit at `note.timeMs + CHART_LEAD_IN_MS`.
 * Prevents mass-miss when the chart mounts slightly behind playback, and gives a
 * short empty runway before the highway appears.
 */
export const CHART_LEAD_IN_MS = 4000;

export function noteHeadTimeMs(note: Note, leadInMs: number): number {
  return note.timeMs + leadInMs;
}

export function noteTailTimeMs(note: Note, leadInMs: number): number {
  return note.timeMs + leadInMs + (note.durationMs ?? 0);
}

/** Last chart event (tap head or hold tail) in playback time. */
export function chartEndPlaybackMs(chart: Chart, leadInMs: number): number {
  let max = 0;
  for (const n of chart.notes) {
    const t = noteTailTimeMs(n, leadInMs);
    if (t > max) max = t;
  }
  return max;
}

export function countChartTapsAndHolds(chart: Chart): {
  taps: number;
  holds: number;
} {
  let taps = 0;
  let holds = 0;
  for (const n of chart.notes) {
    if (n.durationMs > 0) holds += 1;
    else taps += 1;
  }
  return { taps, holds };
}
