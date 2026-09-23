/**
 * The one `AudioContext` for the whole app — hit SFX *and* music-server playback.
 *
 * Sharing it matters for two reasons:
 *   1. The existing `primeHitSound()` unlock (from `useKeybinds`, on first key
 *      press) then also unlocks music. Autoplay policies only need satisfying once.
 *   2. SFX and music read the same `currentTime`, so they can never drift apart.
 *
 * Constructed with **no options** — matching what `hitSound.ts` did before, so
 * sample rate and latency hint stay whatever the platform prefers. Forcing a
 * `sampleRate` here would make `decodeAudioData` resample every track.
 *
 * Music does **not** route through the SFX compressor: that compressor exists to
 * keep dense hit bursts from clipping, and feeding music into it would duck the
 * song on every note hit.
 */

let ctx: AudioContext | null = null;

/** Returns the shared context, creating it on first call. `null` if unavailable. */
export function getAudioContext(): AudioContext | null {
  try {
    if (!ctx || ctx.state === "closed") {
      ctx = new window.AudioContext();
    }
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Resumes the context after a user gesture. Safe to call repeatedly.
 * Returns a promise so callers that must not start audio before the context is
 * running (music playback) can await it; SFX callers can ignore it.
 */
export async function resumeAudioContext(): Promise<AudioContext | null> {
  const c = getAudioContext();
  if (!c) return null;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* Autoplay policy — the next user gesture will get it. */
    }
  }
  return c;
}

/**
 * Hardware output latency in ms: how long after `ctx.currentTime` a sample is
 * actually audible. Subtracted from the music playhead so the chart lines up
 * with what reaches the speakers.
 *
 * `outputLatency` is the accurate figure but is 0 or undefined on some
 * platforms (notably WKWebView on macOS), so fall back to `baseLatency`.
 * Whatever residue is left gets absorbed by
 * `settings.serverPlaybackTimingOffsetMs`.
 */
export function audioOutputLatencyMs(): number {
  const c = ctx;
  if (!c) return 0;
  const seconds =
    (typeof c.outputLatency === "number" && c.outputLatency > 0
      ? c.outputLatency
      : c.baseLatency) || 0;
  // Guard against absurd values from a misreporting driver.
  return Number.isFinite(seconds) && seconds > 0 && seconds < 1
    ? seconds * 1000
    : 0;
}
