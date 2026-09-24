/**
 * Center-of-screen pulse messages — the overlay's replacement for permanent
 * status chips in the bottom bar.
 *
 * A DOM custom event rather than store state, for the same reason lane input is
 * (`spotifyhero:lanehit`): a pulse is a transient effect, not part of the game's
 * state, and nothing should re-render because one is on screen. `ScreenPulse`
 * is the only listener; it owns the animation and tears itself down.
 *
 * Play-mode words (AUTO / MANUAL / PAUSED) are *not* dispatched here — they come
 * from `phase` inside `ScreenPulse`, so every path that changes mode (keybind,
 * transport button, Spotify poll) pulses without having to remember to.
 */

const SCREEN_PULSE_EVENT = "spotifyhero:screenpulse";

export type ScreenPulseDetail = {
  /** Shown in big type. Kept short — the window can be 180 px wide. */
  text: string;
  /** Colour intent; `neutral` is the plain light grey. */
  tone?: "neutral" | "accent" | "warn";
  /** 0–1. Draws a fill bar under the text (volume). */
  bar?: number;
  /**
   * `xl` is for the count-in digits, which are the one thing on screen and want
   * to be read at a glance. Everything else takes the default size-to-fit.
   */
  size?: "md" | "xl";
};

export function pulseScreen(detail: ScreenPulseDetail): void {
  window.dispatchEvent(
    new CustomEvent<ScreenPulseDetail>(SCREEN_PULSE_EVENT, { detail })
  );
}

/** Returns the unsubscribe function, so it can be an effect body one-liner. */
export function onScreenPulse(
  cb: (detail: ScreenPulseDetail) => void
): () => void {
  const handler = (e: Event): void => {
    cb((e as CustomEvent<ScreenPulseDetail>).detail);
  };
  window.addEventListener(SCREEN_PULSE_EVENT, handler);
  return () => window.removeEventListener(SCREEN_PULSE_EVENT, handler);
}
