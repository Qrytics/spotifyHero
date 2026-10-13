/**
 * Plays one decoded song through Web Audio with an exact clock — a trimmed port of the desktop
 * app's `NavidromePlaybackSource` (apps/overlay-ui/src/lib/playback/). No HTMLAudioElement: its
 * `currentTime` is coarse and drifts, while `AudioContext.currentTime` is the clock the samples
 * are actually scheduled on.
 *
 * `positionMs()` is anchored to the *scheduled* start, so it reads negative through a count-in
 * and the opening notes scroll in from the top instead of popping in on the receptors.
 */
let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
  }
  return ctx;
}

/** Must run inside a user gesture the first time, or browsers keep the context suspended. */
export async function unlockAudio(): Promise<void> {
  const c = audioContext();
  if (c.state === "suspended") await c.resume();
}

const START_LEAD_S = 0.02;

export class SongPlayer {
  private node: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private startedAt = 0; // ctx time the offset below is heard
  private startOffsetMs = 0;
  private pausedAtMs = 0;
  private seq = 0;
  playing = false;
  onEnded: (() => void) | null = null;

  constructor(
    readonly buffer: AudioBuffer,
    private volume = 0.8,
  ) {}

  get durationMs(): number {
    return this.buffer.duration * 1000;
  }

  /** Output latency is what the listener hears late by; judging against it keeps hits honest. */
  private latencyMs(): number {
    const c = audioContext();
    return ((c.outputLatency || 0) + (c.baseLatency || 0)) * 1000;
  }

  positionMs(): number {
    if (!this.playing) return this.pausedAtMs;
    const c = audioContext();
    const pos = (c.currentTime - this.startedAt) * 1000 + this.startOffsetMs - this.latencyMs();
    return Math.min(pos, this.durationMs);
  }

  async playFromTop(countInMs: number): Promise<number> {
    await unlockAudio();
    this.start(0, Math.max(0, countInMs) / 1000);
    return this.startedAt;
  }

  async resume(): Promise<void> {
    if (this.playing) return;
    await unlockAudio();
    this.start(this.pausedAtMs, START_LEAD_S);
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAtMs = Math.max(0, this.positionMs());
    this.teardown();
    this.playing = false;
  }

  stop(): void {
    this.teardown();
    this.playing = false;
    this.pausedAtMs = 0;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  private teardown(): void {
    const n = this.node;
    if (!n) return;
    this.seq++; // the stop() below fires onended; ignore it
    this.node = null;
    try {
      n.stop();
    } catch {
      /* never started */
    }
    n.disconnect();
  }

  private start(offsetMs: number, leadS: number): void {
    const c = audioContext();
    this.teardown();
    if (!this.gain) {
      this.gain = c.createGain();
      this.gain.connect(c.destination);
    }
    this.gain.gain.value = this.volume;
    const node = c.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.gain);
    const when = c.currentTime + leadS;
    const offset = Math.min(Math.max(offsetMs, 0), this.durationMs);
    node.start(when, offset / 1000);
    const mySeq = ++this.seq;
    node.onended = () => {
      if (mySeq !== this.seq) return;
      this.playing = false;
      this.pausedAtMs = this.durationMs;
      this.node = null;
      this.onEnded?.();
    };
    this.node = node;
    this.startedAt = when;
    this.startOffsetMs = offset;
    this.playing = true;
  }
}

/** Three soft clicks on the count-in, scheduled on the same clock as the song. */
export function scheduleCountInClicks(startsAt: number, beats: number, beatMs: number): void {
  const c = audioContext();
  for (let i = 0; i < beats; i++) {
    const t = startsAt - ((beats - i) * beatMs) / 1000;
    if (t < c.currentTime) continue;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = i === beats - 1 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.1);
  }
}
