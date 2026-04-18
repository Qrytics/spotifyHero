import type { BeatEvent } from "@spotifyhero/shared-types";

/** Per-onset “excitement” 0–1: fast IOI + pitch hops + flux + RMS motion. */
export function buildOnsetExcitementByTime(
  onsets: readonly BeatEvent[]
): Map<number, number> {
  const sorted = [...onsets]
    .filter((o) => o.isOnset)
    .sort((a, b) => a.timeMs - b.timeMs);
  const map = new Map<number, number>();
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const prev = sorted[i - 1];
    const next = sorted[i + 1];

    const ioiP = prev ? cur.timeMs - prev.timeMs : 99_999;
    const ioiN = next ? next.timeMs - cur.timeMs : 99_999;
    const ioiMin = Math.min(ioiP, ioiN);
    let fastness = 0;
    if (ioiMin < 240) {
      fastness = Math.min(1, (240 - ioiMin) / 240);
    }

    let pitchHop = 0;
    if (
      prev &&
      cur.pitchHz !== undefined &&
      prev.pitchHz !== undefined &&
      cur.pitchHz > 1 &&
      prev.pitchHz > 1
    ) {
      const semi = Math.abs(12 * Math.log2(cur.pitchHz / prev.pitchHz));
      pitchHop = Math.min(1, semi / 7);
    }

    let flux = cur.spectralFlux ?? 0;
    if (flux > 1) flux = 1;
    if (flux < 0) flux = 0;

    let energyHop = 0;
    if (prev && cur.rms !== undefined && prev.rms !== undefined) {
      energyHop = Math.min(1, Math.abs(cur.rms - prev.rms) * 3.5);
    }

    const score = Math.min(
      1,
      0.36 * fastness + 0.34 * pitchHop + 0.17 * flux + 0.13 * energyHop
    );
    map.set(cur.timeMs, score);
  }
  return map;
}

/**
 * One value per beat index (same length as `nBeats`): how much this window looks like
 * a fast melodic run (pitch motion + tight spacing + transients).
 */
export function computeMelodicAggressionPerBeat(
  silenceGatedOnsets: readonly BeatEvent[],
  gridStartMs: number,
  beatPeriodMs: number,
  nBeats: number
): number[] {
  const agg = new Array<number>(nBeats).fill(0);
  if (beatPeriodMs <= 0 || nBeats === 0) return agg;

  const byBeat: number[][] = Array.from({ length: nBeats }, () => []);
  const excitement = buildOnsetExcitementByTime(silenceGatedOnsets);

  for (const o of silenceGatedOnsets) {
    if (!o.isOnset) continue;
    let k = Math.floor((o.timeMs - gridStartMs) / beatPeriodMs);
    if (k < 0) k = 0;
    if (k >= nBeats) k = nBeats - 1;
    const ex = excitement.get(o.timeMs) ?? 0;
    byBeat[k]!.push(ex);
  }

  for (let k = 0; k < nBeats; k++) {
    const xs = byBeat[k]!;
    if (xs.length === 0) continue;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const peak = Math.max(...xs);
    agg[k] = Math.min(1, 0.55 * mean + 0.45 * peak);
  }

  return agg;
}
