import { invoke } from "@tauri-apps/api/core";
import type { SpotifyPoller } from "@spotifyhero/audio-engine";
import type { PlaybackState } from "@spotifyhero/shared-types";
import { PlaybackStateSchema } from "@spotifyhero/shared-types";

/**
 * Polls the Tauri command `get_playback_state` (Spotify Web API on the Rust side).
 */
export class TauriSpotifyPoller implements SpotifyPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: Array<(state: PlaybackState) => void> = [];
  private readonly pollIntervalMs: number;
  private state: PlaybackState | null = null;

  constructor(pollIntervalMs = 750) {
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

  private async tick(): Promise<void> {
    try {
      const raw = await invoke<unknown>("get_playback_state");
      const parsed = PlaybackStateSchema.safeParse(raw);
      if (!parsed.success) return;
      this.state = parsed.data;
      for (const cb of this.callbacks) {
        cb(parsed.data);
      }
    } catch {
      const idle: PlaybackState = {
        isPlaying: false,
        positionMs: 0,
        trackId: null,
        track: null,
      };
      this.state = idle;
      for (const cb of this.callbacks) {
        cb(idle);
      }
    }
  }
}
