import type { ScoreEvent } from "@spotifyhero/shared-types";

const base =
  import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const HIT_SOUND_URL = `${base}sounds/soft-hitfinish.wav`;

/** ~barely audible (linear 0–1). */
const HIT_SFX_VOLUME = 0.01;

let template: HTMLAudioElement | null = null;

function getTemplate(): HTMLAudioElement {
  if (!template) {
    template = new Audio(HIT_SOUND_URL);
    template.preload = "auto";
    template.volume = HIT_SFX_VOLUME;
  }
  return template;
}

/** One microtask batch = one chord / one game-loop tick — single SFX for simultaneous notes. */
let hitSoundBatchQueued = false;
let hitSoundBatchHasPlay = false;

function playHitFinishSfxOnce(): void {
  try {
    const t = getTemplate();
    const a = t.cloneNode(true) as HTMLAudioElement;
    a.volume = HIT_SFX_VOLUME;
    void a.play().catch(() => {});
  } catch {
    /* autoplay / missing file */
  }
}

/**
 * Plays osu skin-style soft hitfinish on timed note hits (Perfect / Great / Good).
 * Skips sustain ticks, misses, and sloppy (Bad) head hits.
 * Chords (multiple notes in one synchronous pass) trigger at most one sound per batch.
 */
export function playHitFinishSfx(event: ScoreEvent): void {
  if (event.countsTowardAccuracy === false) return;
  const j = event.judgement;
  if (j !== "perfect" && j !== "great" && j !== "good") return;

  hitSoundBatchHasPlay = true;
  if (hitSoundBatchQueued) return;
  hitSoundBatchQueued = true;
  queueMicrotask(() => {
    hitSoundBatchQueued = false;
    if (hitSoundBatchHasPlay) {
      hitSoundBatchHasPlay = false;
      playHitFinishSfxOnce();
    }
  });
}
