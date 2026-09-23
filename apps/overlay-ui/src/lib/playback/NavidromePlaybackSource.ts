/**
 * `PlaybackSource` for a personal music server — the first time this game plays
 * audio itself rather than watching someone else play it.
 *
 * Mechanism: download the whole file → `decodeAudioData` → one `AudioBuffer` →
 * `AudioBufferSourceNode → GainNode → ctx.destination`.
 *
 * "Download the whole file first" costs nothing: onset analysis needs the decoded
 * samples and gameplay cannot start without a chart, so the full fetch is already
 * on the critical path. In exchange the playhead is exact:
 *
 *   positionMs = (ctx.currentTime - startedAtCtxTime) * 1000
 *              + startOffsetMs - outputLatencyMs
 *
 * `AudioBufferSourceNode` cannot pause, so pause = `stop()` + freeze the position,
 * and resume = a **fresh node** started at `pausedAtMs` with a new anchor. Seek and
 * restart are the same operation with a different offset.
 *
 * Connects to `ctx.destination` **directly**, bypassing `hitSound.ts`'s
 * compressor: that compressor exists so dense hit bursts don't clip, and feeding
 * music through it would duck the song on every note hit.
 *
 * Memory: a 4-minute stereo buffer at 48 kHz Float32 is ~92 MB, so this holds
 * **exactly one** `AudioBuffer` and nulls it before decoding the next. The
 * downloaded `ArrayBuffer` detaches during `decodeAudioData`.
 */
import type {
  ExactPlaybackClock,
  PlaybackSource,
  PlaybackSourceCapabilities,
  PlaybackSourceEvent,
} from "@spotifyhero/audio-engine";
import type { PlaybackState, Track } from "@spotifyhero/shared-types";
import {
  NavidromeError,
  SERVER_MAX_TRACK_MS,
  toGameTrackId,
  toSubsonicId,
  type NavidromeClient,
  type NavidromeSong,
} from "../navidrome/client.js";
import {
  audioOutputLatencyMs,
  getAudioContext,
  resumeAudioContext,
} from "../audioContext.js";

/**
 * Nodes are scheduled this far ahead of `ctx.currentTime` rather than at it.
 * Starting "now" races the audio thread and can clip the first few ms; the
 * anchor accounts for the lead, so the clock stays correct either way.
 */
const START_SCHEDULE_LEAD_S = 0.02;

const CAPABILITIES: PlaybackSourceCapabilities = {
  exactClock: true,
  /** No scrub bar and no practice mode in v1 — see the plan's "Why no scrubbing". */
  seek: false,
  localVolume: true,
  emitsTransportEvents: true,
};

/** What `prepare()` hands back: the game's `Track` plus the decoded samples. */
export type PreparedServerTrack = {
  track: Track;
  /** Kept alive by this source; onset analysis downmixes it, never stores it. */
  buffer: AudioBuffer;
};

/** Coarse pipeline stage, mirrored into the store by the caller. */
export type PrepareStage = "downloading" | "decoding";

export type PrepareOptions = {
  onProgress?: (stage: PrepareStage, progress: number | null) => void;
  signal?: AbortSignal;
};

export class NavidromePlaybackSource implements PlaybackSource {
  readonly id = "server" as const;
  readonly capabilities = CAPABILITIES;

  private client: NavidromeClient | null = null;
  private track: Track | null = null;
  private buffer: AudioBuffer | null = null;
  private gain: GainNode | null = null;
  private node: AudioBufferSourceNode | null = null;
  /** Cached so the per-frame clock does no lookup work. */
  private ctx: AudioContext | null = null;

  /** `ctx.currentTime` the live node was scheduled for (may be slightly future). */
  private startedAtCtxTime = 0;
  /** Buffer offset, in ms, that the live node was started at. */
  private startOffsetMs = 0;
  /**
   * Hardware latency sampled when the live node was anchored. Read once per
   * anchor rather than per frame: it should not wobble mid-track, and the clock
   * runs in rAF.
   */
  private outputLatencyMs = 0;
  /** Authoritative position while stopped. */
  private pausedAtMs = 0;
  private playing = false;
  private volumeUnit01 = 1;
  /** One scrobble per prepared track — resuming from pause is not a new play. */
  private scrobbled = false;

  /**
   * Distinguishes "the buffer reached its end" from "we called `stop()`".
   * `onended` fires for both, so every node carries the seq it was created with
   * and a callback from a superseded node returns early.
   */
  private nodeSeq = 0;

  private listeners = new Set<(ev: PlaybackSourceEvent) => void>();

  readonly clock: ExactPlaybackClock = {
    isExact: true,
    estimateMs: () => this.positionMs(),
    reset: () => {
      this.pausedAtMs = 0;
      this.startOffsetMs = 0;
      this.startedAtCtxTime = 0;
    },
  };

  // -- Lifecycle ------------------------------------------------------------

  start(): void {
    /* Nothing to arm: `prepare()` is the entry point. */
  }

  /** Releases the node, the gain node and the ~92 MB buffer. */
  stop(): void {
    this.teardownNode();
    this.gain?.disconnect();
    this.gain = null;
    this.buffer = null;
    this.track = null;
    this.playing = false;
    this.scrobbled = false;
    this.pausedAtMs = 0;
    this.startOffsetMs = 0;
    this.startedAtCtxTime = 0;
  }

  // -- Preparation ----------------------------------------------------------

  /**
   * Downloads and decodes `song`, then emits `isPlaying: false, positionMs: 0`.
   *
   * Deliberately does **not** start audio: playback begins when the chart lands
   * and `phase` reaches `autoplay`. Starting here would play a few seconds of
   * music under a "Generating chart…" screen.
   *
   * Not part of `PlaybackSource` — it is this source's own entry point, and the
   * caller needs the decoded buffer for onset analysis.
   */
  async prepare(
    client: NavidromeClient,
    song: NavidromeSong,
    opts: PrepareOptions = {}
  ): Promise<PreparedServerTrack> {
    this.client = client;
    // Free the previous track before allocating the next: two 92 MB buffers
    // resident at once is the difference between fine and a swap storm.
    this.stop();

    // The click that chose this song is the user gesture the autoplay policy
    // wants, and it is the last one we are guaranteed before `play()` — which
    // happens later, once the chart lands. Unlock now.
    await resumeAudioContext();

    opts.onProgress?.("downloading", 0);
    const bytes = await client.fetchTrackBytes(song.id, {
      format: "raw",
      ...(opts.signal ? { signal: opts.signal } : {}),
      onProgress: (received, total) => {
        opts.onProgress?.("downloading", total ? received / total : null);
      },
    });

    opts.onProgress?.("decoding", null);
    let buffer: AudioBuffer;
    try {
      buffer = await this.decode(bytes);
    } catch {
      // WKWebView on macOS is weaker than Chromium at FLAC and especially
      // Opus/Ogg. `decodeAudioData` detaches the ArrayBuffer, so the retry has
      // to re-download — as an mp3 transcode this time.
      opts.onProgress?.("downloading", 0);
      const mp3 = await client.fetchTrackBytes(song.id, {
        format: "mp3",
        ...(opts.signal ? { signal: opts.signal } : {}),
        onProgress: (received, total) => {
          opts.onProgress?.("downloading", total ? received / total : null);
        },
      });
      opts.onProgress?.("decoding", null);
      try {
        buffer = await this.decode(mp3);
      } catch (e) {
        throw new NavidromeError(
          `This track's audio format cannot be decoded here: ${
            e instanceof Error ? e.message : String(e)
          }`,
          "server"
        );
      }
    }

    const durationMs = Math.round(buffer.duration * 1000);
    // Subsonic's `Child.duration` is second-granular, so the library UI's
    // length check can let a borderline track through. The decoded length is
    // exact — re-check it here, before anything holds the buffer.
    if (durationMs > SERVER_MAX_TRACK_MS) {
      throw new NavidromeError(
        "That track is too long to analyse (limit is 12 minutes).",
        "server"
      );
    }
    if (durationMs <= 0) {
      // `Track.durationMs` must be positive, and chart-end detection divides by
      // it. Refuse rather than hold a buffer nothing can play.
      throw new NavidromeError("That track decoded to zero length.", "server");
    }

    this.buffer = buffer;
    this.track = trackFromSong(client, song, durationMs);
    this.pausedAtMs = 0;
    this.playing = false;
    this.emitState();

    return { track: this.track, buffer };
  }

  // -- Transport ------------------------------------------------------------

  async play(): Promise<void> {
    if (!this.buffer || this.playing) return;
    await resumeAudioContext();
    // A finished track's play button means "again", not "replay the last 20 ms".
    if (this.pausedAtMs >= this.durationMs()) this.pausedAtMs = 0;
    this.startNodeAt(this.pausedAtMs);
    this.emitState();
    void this.scrobble();
  }

  async pause(): Promise<void> {
    if (!this.playing) return;
    this.pausedAtMs = this.positionMs();
    this.teardownNode();
    this.playing = false;
    // Same `trackId` as before, on purpose: `onScoreEvents` drops every event
    // whose `playback.trackId` differs from `chart.trackId`, and the game loop
    // bails on the same comparison.
    this.emitState();
  }

  /**
   * Repositions playback. v1 only ever reaches this with `0`, from `restart()`
   * — `capabilities.seek` is `false` and no UI exposes a scrub bar. It exists
   * because restart is the same operation, and so practice mode has a seam.
   */
  async seek(positionMs: number): Promise<void> {
    if (!this.buffer) return;
    if (this.playing) {
      await resumeAudioContext();
      this.startNodeAt(positionMs);
    } else {
      this.teardownNode();
      this.pausedAtMs = clamp(positionMs, 0, this.durationMs());
    }
    this.emitState();
  }

  async restart(): Promise<void> {
    if (!this.buffer) return;
    await resumeAudioContext();
    this.startNodeAt(0);
    // Ahead of the state event so the loop resets scoring from the event rather
    // than inferring it from the backward position jump.
    this.emit({ type: "restarted" });
    this.emitState();
  }

  async setVolume(unit01: number): Promise<void> {
    this.volumeUnit01 = clamp(unit01, 0, 1);
    if (this.gain) this.gain.gain.value = this.volumeUnit01;
    // Emit so the HUD's volume readout stays truthful.
    this.emitState();
  }

  onEvent(cb: (ev: PlaybackSourceEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // -- Internals ------------------------------------------------------------

  private durationMs(): number {
    return this.track?.durationMs ?? 0;
  }

  /**
   * The exact playhead. Slightly negative just after a start is scheduled (the
   * node has not begun yet) and that is truthful — do not clamp it up, or the
   * first notes of a chart would judge against a stalled clock.
   */
  private positionMs(): number {
    const ctx = this.ctx;
    if (!this.playing || !ctx) return this.pausedAtMs;
    const elapsedMs = (ctx.currentTime - this.startedAtCtxTime) * 1000;
    const pos = elapsedMs + this.startOffsetMs - this.outputLatencyMs;
    // Cap at the track length: `onended` is a callback, so a frame can land
    // after the buffer has run out but before we have been told.
    return Math.min(pos, this.durationMs());
  }

  private async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = getAudioContext();
    if (!ctx) throw new Error("Web Audio is unavailable");
    return ctx.decodeAudioData(bytes);
  }

  /** Stops and discards the live node. Safe when there is none. */
  private teardownNode(): void {
    const node = this.node;
    if (!node) return;
    // Bump first: the `stop()` below triggers `onended`, which must be ignored.
    this.nodeSeq += 1;
    this.node = null;
    try {
      node.stop();
    } catch {
      /* Already stopped or never started. */
    }
    node.disconnect();
  }

  /** Starts a fresh node at `offsetMs` and re-anchors the clock to it. */
  private startNodeAt(offsetMs: number): void {
    const ctx = getAudioContext();
    if (!ctx || !this.buffer) return;

    this.teardownNode();

    if (!this.gain) {
      this.gain = ctx.createGain();
      // Straight to the output — never through the SFX compressor.
      this.gain.connect(ctx.destination);
    }
    this.gain.gain.value = this.volumeUnit01;

    const offset = clamp(offsetMs, 0, this.durationMs());
    const when = ctx.currentTime + START_SCHEDULE_LEAD_S;
    const seq = this.nodeSeq;
    this.ctx = ctx;
    this.outputLatencyMs = audioOutputLatencyMs();

    const node = ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.gain);
    node.onended = () => {
      if (this.nodeSeq !== seq) return; // Superseded by pause / seek / restart.
      this.node = null;
      this.playing = false;
      this.pausedAtMs = this.durationMs();
      this.emitState();
      this.emit({ type: "ended" });
    };
    node.start(when, offset / 1000);

    this.node = node;
    this.startedAtCtxTime = when;
    this.startOffsetMs = offset;
    this.pausedAtMs = offset;
    this.playing = true;
  }

  private stateNow(): PlaybackState {
    return {
      isPlaying: this.playing,
      // `PlaybackStateSchema` requires non-negative; the raw clock may be a few
      // ms negative while a start is still scheduled.
      positionMs: Math.max(0, Math.round(this.positionMs())),
      trackId: this.track?.id ?? null,
      track: this.track,
      volumePercent: Math.round(this.volumeUnit01 * 100),
      source: "server",
    };
  }

  private emitState(): void {
    this.emit({ type: "state", state: this.stateNow() });
  }

  private emit(ev: PlaybackSourceEvent): void {
    for (const cb of this.listeners) cb(ev);
  }

  /**
   * `/rest/stream` explicitly does not count plays, so ask for it separately —
   * once per prepared track, so pause/resume does not inflate the play count.
   */
  private async scrobble(): Promise<void> {
    if (this.scrobbled) return;
    const id = this.track ? toSubsonicId(this.track.id) : null;
    if (!id || !this.client) return;
    this.scrobbled = true;
    await this.client.scrobble(id);
  }
}

// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * `NavidromeSong` → the game's source-agnostic `Track`.
 *
 * `durationMs` is the **decoded** length, not `song.duration` (seconds,
 * rounded), because `scoreClampMs` and chart-end detection compare against it.
 *
 * `bpm` is deliberately left off even when the file carries a BPM tag: tempo
 * comes from onset analysis and lands on `Chart.bpm`. A tag here would feed
 * `demoBeatEvents`, which must never run for server tracks.
 *
 * NOTE: `albumArt` is a credentialed `getCoverArt` URL (it carries `u`/`t`/`s`).
 * That is acceptable because `playback` is in-memory only — it is not persisted,
 * and `spotifyDiagnostics` dumps only `trackId`/`trackName`. The **stream** URL
 * never enters `PlaybackState` under any circumstances.
 */
function trackFromSong(
  client: NavidromeClient,
  song: NavidromeSong,
  durationMs: number
): Track {
  return {
    id: toGameTrackId(song.id),
    name: song.title,
    artists: song.artist ? [song.artist] : [],
    durationMs,
    ...(song.coverArt ? { albumArt: client.coverArtUrl(song.coverArt, 300) } : {}),
    ...(song.album ? { album: song.album } : {}),
  };
}
