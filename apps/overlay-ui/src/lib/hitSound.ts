import type { ScoreEvent } from "@spotifyhero/shared-types";

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;

type HitEventMeta = { lane: number; combo: number; prevCombo: number; pitchHz?: number };

const HIT_BASE_FREQ = [400, 500, 600, 700] as const;

let hitBatchQueued = false;
let hitBatch: HitEventMeta[] = [];
let missPending = false;

function ensureAudioContext(): AudioContext | null {
  try {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new window.AudioContext();
      masterGain = audioCtx.createGain();
      compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 20;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.12;
      masterGain.gain.value = 0.7;
      masterGain.connect(compressor);
      compressor.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function scheduleTone(ctx: AudioContext, frequency: number, durationMs: number, gainPeak: number): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.connect(gain);
  gain.connect(masterGain ?? ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

function playHitChord(events: readonly HitEventMeta[]): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  for (const ev of events) {
    const base = ev.pitchHz && ev.pitchHz > 30 ? Math.min(1600, Math.max(90, ev.pitchHz)) : HIT_BASE_FREQ[ev.lane] ?? 520;
    scheduleTone(ctx, base, 60, 0.11);
  }
}

function playMissThud(): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(58, now + 0.08);
  gain.gain.setValueAtTime(0.025, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  osc.connect(gain);
  gain.connect(masterGain ?? ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

function playMilestoneChime(): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const steps = [740, 920, 1160] as const;
  const start = ctx.currentTime;
  for (let i = 0; i < steps.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = start + i * 0.08;
    osc.type = "triangle";
    const freq = steps[i] ?? 1160;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    osc.connect(gain);
    gain.connect(masterGain ?? ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

export function primeHitSound(): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
}

export function playScoreEventSfx(event: ScoreEvent, lane: number, prevCombo: number, pitchHz?: number): void {
  const j = event.judgement;
  const isGoodHit =
    (j === "perfect" || j === "great" || j === "good") &&
    event.countsTowardAccuracy !== false;
  // User requested no note-hit SFX; skip all successful-hit tones/chimes.
  if (isGoodHit) return;
  if (j === "miss" || j === "bad") {
    missPending = true;
  }
  if (hitBatchQueued) return;
  hitBatchQueued = true;
  queueMicrotask(() => {
    hitBatchQueued = false;
    hitBatch = [];
    if (missPending) {
      missPending = false;
      playMissThud();
    }
  });
}
