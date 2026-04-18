import type { BeatEvent, PlaybackState } from "@spotifyhero/shared-types";

// ---------------------------------------------------------------------------
// Interfaces / contracts
// ---------------------------------------------------------------------------

/** Fired when the Spotify playback state changes. */
export type PlaybackStateCallback = (state: PlaybackState) => void;

/** Fired for each detected beat / onset from the audio analysis. */
export type BeatEventCallback = (event: BeatEvent) => void;

/**
 * SpotifyPoller – polls the Spotify Web API (or local Tauri IPC bridge)
 * for the current playback state at regular intervals.
 *
 * In production this is implemented in the Rust backend via the Tauri IPC
 * layer; this TypeScript interface describes the shape so the UI layer can
 * remain independent of the transport.
 */
export interface SpotifyPoller {
  /** Start polling.  Throws if credentials are missing. */
  start(): void;
  /** Stop polling and clear internal timers. */
  stop(): void;
  /** Register a callback that fires whenever state changes. */
  onStateChange(cb: PlaybackStateCallback): void;
  /** Current known state (null before first poll). */
  currentState(): PlaybackState | null;
}

/**
 * BeatTracker – receives raw audio samples (or energy frames from the Rust
 * backend over IPC) and emits BeatEvents.
 *
 * The canonical implementation lives in `packages/chart-generator` (hybrid
 * pipeline).  This interface is used by the gameplay loop to decouple it
 * from the specific detection algorithm.
 */
export interface BeatTracker {
  onBeat(cb: BeatEventCallback): void;
  start(): void;
  stop(): void;
}

/**
 * LatencyCalibrator – measures the round-trip offset between Spotify
 * position reports and the actual playback and provides a correction delta.
 */
export interface LatencyCalibrator {
  /** Run a short calibration sequence and return the measured offset in ms. */
  calibrate(): Promise<number>;
  /** Best-known offset (ms) to add to Spotify's reported position. */
  offsetMs: number;
}

// ---------------------------------------------------------------------------
// Simple mock implementations (for testing / demo)
// ---------------------------------------------------------------------------

/**
 * MockSpotifyPoller – drives the UI with synthetic playback state.
 * Replace with the real Tauri IPC–backed implementation.
 */
export class MockSpotifyPoller implements SpotifyPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callbacks: PlaybackStateCallback[] = [];
  private state: PlaybackState;
  private readonly pollIntervalMs: number;

  constructor(
    initialState: PlaybackState = {
      isPlaying: false,
      positionMs: 0,
      trackId: null,
      track: null,
    },
    pollIntervalMs = 500
  ) {
    this.state = initialState;
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => {
      if (this.state.isPlaying) {
        this.state = {
          ...this.state,
          positionMs: this.state.positionMs + this.pollIntervalMs,
        };
        this.emit(this.state);
      }
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  onStateChange(cb: PlaybackStateCallback): void {
    this.callbacks.push(cb);
  }

  currentState(): PlaybackState {
    return this.state;
  }

  /** Simulate Spotify playback starting or changing tracks. */
  simulatePlay(state: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...state, isPlaying: true };
    this.emit(this.state);
  }

  simulatePause(): void {
    this.state = { ...this.state, isPlaying: false };
    this.emit(this.state);
  }

  private emit(state: PlaybackState): void {
    for (const cb of this.callbacks) cb(state);
  }
}

// ---------------------------------------------------------------------------
// Timing utilities
// ---------------------------------------------------------------------------

/**
 * DriftCorrector – maintains a running estimate of drift between
 * Spotify's reported position and real elapsed time so the note
 * highway stays aligned.
 */
export class DriftCorrector {
  private referenceWallTime: number | null = null;
  private referencePositionMs = 0;
  private _offsetMs = 0;

  /** Call whenever you receive a fresh position from Spotify. */
  update(spotifyPositionMs: number): void {
    const now = Date.now();
    if (this.referenceWallTime === null) {
      this.referenceWallTime = now;
      this.referencePositionMs = spotifyPositionMs;
      return;
    }

    const elapsed = now - this.referenceWallTime;
    const expectedPos = this.referencePositionMs + elapsed;
    this._offsetMs = spotifyPositionMs - expectedPos;

    // Update reference to avoid unbounded growth
    this.referenceWallTime = now;
    this.referencePositionMs = spotifyPositionMs;
  }

  /** The corrected playback position given raw Spotify position. */
  correct(spotifyPositionMs: number): number {
    return spotifyPositionMs - this._offsetMs;
  }

  get offsetMs(): number {
    return this._offsetMs;
  }

  reset(): void {
    this.referenceWallTime = null;
    this.referencePositionMs = 0;
    this._offsetMs = 0;
  }
}
