/**
 * Game playhead: advances smoothly at real-time speed between Spotify polls.
 *
 * Poll samples often jitter by tens of ms. While playing, we **ignore** small
 * differences between Spotify's position and our extrapolation so the highway
 * does not snap on every poll. We only re-anchor when:
 *   - track changes
 *   - pause / resume (or staying paused — follow reported position)
 *   - drift exceeds ~95ms (buffering, real slowdown, seek, scrub)
 *
 * Call `sync()` when new playback arrives from the poller — never from rAF.
 */
/** Below this, Spotify poll is treated as jitter — keep extrapolating. */
const IGNORE_DRIFT_MS = 135;

class PlaybackClockImpl {
  private anchorPerf = 0;
  private anchorPos = 0;
  private playing = false;
  private trackId: string | null = null;

  sync(positionMs: number, isPlaying: boolean, trackId: string | null): void {
    const now = performance.now();

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
    return this.anchorPos + (performance.now() - this.anchorPerf);
  }

  reset(): void {
    this.anchorPerf = 0;
    this.anchorPos = 0;
    this.playing = false;
    this.trackId = null;
  }
}

export const playbackClock = new PlaybackClockImpl();
