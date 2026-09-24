import type { ScoreEvent } from "@spotifyhero/shared-types";
import { getAudioContext, resumeAudioContext } from "./audioContext.js";

/**
 * The context is shared with music-server playback (`lib/audioContext.ts`) so
 * `primeHitSound()` unlocks both and the two can never drift. The gain +
 * compressor chain below stays **SFX-only**: music connects straight to
 * `ctx.destination`, because routing it through this compressor would duck the
 * song on every hit.
 */
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;

type HitEventMeta = { lane: number; combo: number; prevCombo: number; pitchHz?: number };

const HIT_BASE_FREQ = [400, 500, 600, 700] as const;

let hitBatchQueued = false;
let hitBatch: HitEventMeta[] = [];
let missPending = false;

function ensureAudioContext(): AudioContext | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  // Rebuild the SFX chain if this is a different context than we last wired.
  if (audioCtx !== ctx || !masterGain) {
    audioCtx = ctx;
    masterGain = ctx.createGain();
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 20;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.12;
    masterGain.gain.value = 0.7;
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void resumeAudioContext();
  return ctx;
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

/**
 * One drumstick click: a short noise burst through a tight bandpass.
 *
 * Noise, not an oscillator — a stick hit is a transient with no pitch, and a
 * beep at 2 kHz sounds like a UI error instead of a count-in. The buffer is
 * built per click, which is fine: four clicks per song, never per frame.
 */
function scheduleStickClick(
  ctx: AudioContext,
  atTime: number,
  centreHz: number,
  gainPeak: number
): void {
  const durationS = 0.035;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * durationS));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Steep decay: all the energy in the first few ms is what reads as "wood".
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 3.2);
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = centreHz;
  band.Q.value = 1.4;
  const gain = ctx.createGain();
  gain.gain.value = gainPeak;

  src.connect(band);
  band.connect(gain);
  gain.connect(masterGain ?? ctx.destination);
  // A time already in the past starts immediately, which is the right recovery.
  src.start(Math.max(atTime, ctx.currentTime));
}

/**
 * Count-in clicks leading up to `startsAtCtxTime` — `beats` of them before the
 * music plus a brighter, louder one landing exactly on the downbeat ("GO").
 *
 * Scheduled on the `AudioContext`, against the same time base the music node was
 * scheduled on, so the ticks cannot drift from the first note no matter what the
 * main thread is doing. Called by `lib/countIn.ts`.
 */
export function scheduleCountInClicks(
  startsAtCtxTime: number,
  beats: number,
  beatMs: number
): void {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const beatS = beatMs / 1000;
  for (let i = beats; i >= 1; i--) {
    scheduleStickClick(ctx, startsAtCtxTime - i * beatS, 1900, 0.5);
  }
  scheduleStickClick(ctx, startsAtCtxTime, 3000, 0.75);
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
