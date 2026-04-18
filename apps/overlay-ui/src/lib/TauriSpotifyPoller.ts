import { invoke } from "@tauri-apps/api/core";
import type { SpotifyPoller } from "@spotifyhero/audio-engine";
import type { PlaybackState } from "@spotifyhero/shared-types";
import { PlaybackStateSchema } from "@spotifyhero/shared-types";
import {
  publishSpotifyDiagnostics,
  truncateForDiagnostics,
  type SpotifyPollDiagnostics,
} from "./spotifyDiagnostics.js";

/**
 * Polls the Tauri command `get_playback_state` (Spotify Web API on the Rust side).
 * Default interval is several seconds: `playbackClock` extrapolates between polls;
 * we mainly need to notice pauses, seeks, and track changes. A future improvement is
 * `GET /v1/me/player/queue` (Spotify) to prefetch the next track and relax polling further.
 */
export class TauriSpotifyPoller implements SpotifyPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: Array<(state: PlaybackState) => void> = [];
  private readonly pollIntervalMs: number;
  private state: PlaybackState | null = null;

  constructor(pollIntervalMs = 500) {
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => void this.tick(), this.pollIntervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  onStateChange(cb: (state: PlaybackState) => void): void {
    this.callbacks.push(cb);
  }

  currentState(): PlaybackState | null {
    return this.state;
  }

  private pushDiag(partial: Omit<SpotifyPollDiagnostics, "updatedAt"> & { updatedAt?: string }) {
    const d: SpotifyPollDiagnostics = {
      updatedAt: partial.updatedAt ?? new Date().toISOString(),
      invokeError: partial.invokeError ?? null,
      zodFlat: partial.zodFlat ?? null,
      raw: partial.raw ?? null,
      parsed: partial.parsed ?? null,
    };
    publishSpotifyDiagnostics(d);
  }

  private async tick(): Promise<void> {
    const ts = new Date().toISOString();
    try {
      const raw = await invoke<unknown>("get_playback_state");
      const parsed = PlaybackStateSchema.safeParse(raw);
      if (!parsed.success) {
        if (import.meta.env.DEV) {
          console.warn(
            "[spotifyHero] get_playback_state JSON did not match PlaybackState:",
            parsed.error.flatten(),
            raw
          );
        }
        this.pushDiag({
          updatedAt: ts,
          invokeError: null,
          zodFlat: parsed.error.flatten() as Record<string, unknown>,
          raw: truncateForDiagnostics(raw),
          parsed: null,
        });
        return;
      }
      const data = parsed.data;
      this.pushDiag({
        updatedAt: ts,
        invokeError: null,
        zodFlat: null,
        raw: truncateForDiagnostics(raw),
        parsed: {
          isPlaying: data.isPlaying,
          positionMs: data.positionMs,
          trackId: data.trackId,
          trackName: data.track?.name ?? null,
        },
      });
      this.state = data;
      for (const cb of this.callbacks) {
        cb(data);
      }
    } catch (e) {
      // Do not force idle on network/rate-limit/command errors — that hides playback and
      // feels "stuck". Keep the last good state until the next successful poll.
      if (import.meta.env.DEV) {
        console.warn("[spotifyHero] get_playback_state invoke failed:", e);
      }
      this.pushDiag({
        updatedAt: ts,
        invokeError: e instanceof Error ? e.message : String(e),
        zodFlat: null,
        raw: null,
        parsed: null,
      });
    }
  }
}
