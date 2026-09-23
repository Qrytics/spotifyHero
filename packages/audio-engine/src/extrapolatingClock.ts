/**
 * Game playhead for transports that only report position occasionally
 * (i.e. Spotify): advances smoothly at real-time speed between polls.
 *
 * Poll samples often jitter by tens of ms. While playing, we **ignore** small
 * differences between the reported position and our extrapolation so the
 * highway does not snap on every poll. We only re-anchor when:
 *   - track changes
 *   - pause / resume (or staying paused — follow reported position)
 *   - drift exceeds `IGNORE_DRIFT_MS` (buffering, real slowdown, seek, scrub)
 *
 * Call `sync()` when new playback arrives from the poller — never from rAF.
 *
 * Moved here from `apps/overlay-ui/src/lib/playbackClock.ts` unchanged;
 * that path is now a re-export shim.
 */

/** Below this, a poll sample is treated as jitter — keep extrapolating. */
export const IGNORE_DRIFT_MS = 135;

/** Injectable monotonic clock, so tests do not have to sleep. */
export type NowFn = () => number;

export class PlaybackClockImpl {
  private anchorPerf = 0;
  private anchorPos = 0;
  private playing = false;
  private trackId: string | null = null;
  private readonly now: NowFn;

  /** This clock reconstructs position — it is never sample-exact. */
  readonly isExact = false as const;

  constructor(now: NowFn = () => performance.now()) {
    this.now = now;
  }

  sync(positionMs: number, isPlaying: boolean, trackId: string | null): void {
    const now = this.now();

    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.anchorPerf = now;
      this.anchorPos = positionMs;
      this.playing = isPlaying;
      return;
    }

    if (isPlaying !== this.playing) {
      this.anchorPerf = now;
      this.anchorPos = positionMs;
      this.playing = isPlaying;
      return;
    }

    if (!isPlaying) {
      this.anchorPerf = now;
      this.anchorPos = positionMs;
      return;
    }

    const estimated = this.anchorPos + (now - this.anchorPerf);
    const drift = positionMs - estimated;

    if (Math.abs(drift) < IGNORE_DRIFT_MS) {
      return;
    }

    this.anchorPerf = now;
    this.anchorPos = positionMs;
  }

  /** Use in rAF / game loop — not from React render. */
  estimateMs(): number {
    if (!this.playing) return this.anchorPos;
    return this.anchorPos + (this.now() - this.anchorPerf);
  }

  reset(): void {
    this.anchorPerf = 0;
    this.anchorPos = 0;
    this.playing = false;
    this.trackId = null;
  }
}
