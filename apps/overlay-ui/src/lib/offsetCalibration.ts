/** Signed distance from `p` to nearest multiple of `beatMs` (toward −beatMs/2 … +beatMs/2). */
export function distToNearestBeat(p: number, beatMs: number): number {
  if (!(beatMs > 0) || !Number.isFinite(p)) return 0;
  const m = ((p % beatMs) + beatMs) % beatMs;
  return m > beatMs / 2 ? m - beatMs : m;
}

function median(nums: readonly number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * From raw playhead samples when the user tapped on the beat, estimate offset to apply
 * so chart time aligns with heard audio (median of wrapped errors, inverted, clamped).
 */
export function computePlaybackTimingOffsetFromTaps(
  tapPositionsMs: number[],
  beatMs: number
): number {
  if (tapPositionsMs.length < 4 || !(beatMs > 0)) return 0;
  const dists = tapPositionsMs.map((p) => distToNearestBeat(p, beatMs));
  const med = median(dists);
  const o = -Math.round(med) || 0;
  return Math.max(-500, Math.min(500, o));
}
