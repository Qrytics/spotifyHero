import { useEffect } from "react";
import {
  MAX_SCROLL_SPEED,
  MIN_SCROLL_SPEED,
  stepScrollSpeed,
} from "@spotifyhero/gameplay-core";
import { useGameStore } from "../store/gameStore.js";
import { toggleSpotifyDebugPanel } from "../lib/spotifyDiagnostics.js";
import { eventMatchesPlayKey } from "../lib/keybindDisplay.js";
import { primeHitSound } from "../lib/hitSound.js";
import { activePlaybackSource } from "../lib/playback/activeSource.js";
import { playWithOptionalCountIn } from "../lib/countIn.js";
import { pulseScreen } from "../lib/screenPulse.js";

/** One press of `-` / `=`. 20 presses across the range, which felt right by hand. */
const VOLUME_STEP_PERCENT = 5;

/** `_` and `+` so Shift does not swallow the key; numpad reports `-` / `+`. */
const VOLUME_DOWN_KEYS = new Set(["-", "_"]);
const VOLUME_UP_KEYS = new Set(["=", "+"]);

/**
 * Nudges the game's own output gain and pulses the new level over the highway.
 *
 * Only music-server mode has a gain to move — `capabilities.localVolume` is
 * false for Spotify, where the volume belongs to the Spotify client and the
 * device mixer. Saying so is better than a dead key.
 */
function stepVolume(direction: -1 | 1): void {
  const src = activePlaybackSource();
  if (!src?.capabilities.localVolume) {
    pulseScreen({ text: "VOLUME IS IN SPOTIFY" });
    return;
  }
  const current = useGameStore.getState().playback?.volumePercent ?? 100;
  // Snap to the step grid first, so a level set elsewhere (or a 100 default)
  // still lands on round numbers.
  const snapped = Math.round(current / VOLUME_STEP_PERCENT) * VOLUME_STEP_PERCENT;
  const next = Math.min(
    100,
    Math.max(0, snapped + direction * VOLUME_STEP_PERCENT)
  );
  void src.setVolume(next / 100);
  pulseScreen({ text: `${next}%`, bar: next / 100 });
}

/**
 * Nudges how fast notes travel and pulses the new multiplier.
 *
 * Difficulty already picks a sensible speed (`DIFFICULTY_SCROLL_SPEED`); this is
 * the per-player adjustment on top of it, on the arrow keys so it can be done
 * mid-song without opening settings. Same value the settings slider writes, so
 * the two never disagree — and it persists, because a speed you had to find by
 * feel should not reset next launch.
 */
function stepSpeed(direction: -1 | 1): void {
  const store = useGameStore.getState();
  const current = store.settings.noteScrollSpeed;
  const next = stepScrollSpeed(current, direction);
  if (next !== current) store.updateSettings({ noteScrollSpeed: next });
  pulseScreen({
    text: `${next.toFixed(1)}×`,
    bar: (next - MIN_SCROLL_SPEED) / (MAX_SCROLL_SPEED - MIN_SCROLL_SPEED),
  });
}

/**
 * In-flight guard, the keyboard's copy of `ServerTransportControls`' `busy`: one
 * `pause()`/`play()` at a time, so a double-tap of the key cannot pause and
 * resume in the same breath.
 */
let transportBusy = false;

/**
 * Pause / resume the audio **the game itself is playing** — Mode 1 only.
 *
 * Deliberately the same two calls the ❙❙ button makes, `playWithOptionalCountIn`
 * included: a song paused during its own count-in has to count in again, or the
 * notes it was holding back land on the receptors the instant the audio returns.
 *
 * Nothing pulses "PAUSED" here — `ScreenPulse` derives the play-mode word from
 * `phase`, and `pause()` → `setPlayback({isPlaying: false})` → `phase: "paused"`
 * is what reaches it. Same for the resume.
 */
function toggleServerTransport(paused: boolean): void {
  if (transportBusy) return;
  const src = activePlaybackSource();
  if (!src) return;
  transportBusy = true;
  void (paused ? playWithOptionalCountIn() : src.pause()).finally(() => {
    transportBusy = false;
  });
}

function dispatchLaneDown(laneIndex: number): void {
  window.dispatchEvent(
    new CustomEvent("spotifyhero:lanedown", { detail: { lane: laneIndex } })
  );
}

function dispatchLaneHit(laneIndex: number): void {
  window.dispatchEvent(
    new CustomEvent("spotifyhero:lanehit", {
      detail: { lane: laneIndex, timeMs: Date.now() },
    })
  );
}

function dispatchLaneUp(laneIndex: number): void {
  window.dispatchEvent(
    new CustomEvent("spotifyhero:laneup", { detail: { lane: laneIndex } })
  );
}

/**
 * useKeybinds
 *
 * Registers global keyboard listeners for the game.
 *
 * **Inputs (from game store):**
 *   - `settings.playKeybind` — default `Space`. **Pauses / resumes** in music-server
 *     mode, where the game owns the audio; toggles autoplay ↔ manual under Spotify,
 *     where it cannot.
 *   - `settings.laneKeys` — array of 4 keys for lanes 0–3 (default `["d","f","j","k"]`)
 *
 * **Fixed keys (not configurable):**
 *   - `-` / `=` — volume down/up in {@link VOLUME_STEP_PERCENT} steps, repeat-friendly
 *   - `↑` / `↓` — note scroll speed, one `SCROLL_SPEED_STEP` per press
 *   - `Ctrl+Shift+D` — Spotify diagnostics panel
 *
 * **Outputs (DOM events dispatched):**
 *   - `spotifyhero:lanedown` — fired on key-down for a lane key
 *   - `spotifyhero:lanehit` — fired on key-down with `{ lane, timeMs }` for scoring
 *   - `spotifyhero:laneup` — fired on key-up for a lane key
 *
 * **Side effects:**
 *   - Play key: pauses/resumes the live source in music-server mode, otherwise
 *     calls `togglePlayMode()` on the store
 *   - Calls `primeHitSound()` on first lane key press (unlocks AudioContext)
 *   - Pressing a lane key while in `autoplay` phase automatically switches to `manual`
 *
 * **Mockable:** Dispatch `spotifyhero:lanehit` events manually in tests to simulate input.
 */
export function useKeybinds(): void {
  const settings = useGameStore((s) => s.settings);
  const togglePlayMode = useGameStore((s) => s.togglePlayMode);

  useEffect(() => {
    const { playKeybind, laneKeys } = settings;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!document.hasFocus()) return;
      if (useGameStore.getState().calibrationActive) return;
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl?.closest?.("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (e.metaKey || e.altKey) return;

      // Volume sits above the `e.repeat` guard on purpose — holding `-` should
      // ramp down — but below the configured binds, so a player who bound `-`
      // to a lane still gets the lane. Ctrl is excluded: Ctrl +/- is zoom.
      const bound =
        laneKeys.some((k) => k.toLowerCase() === key) ||
        eventMatchesPlayKey(e, playKeybind);
      if (!bound && !e.ctrlKey) {
        const direction = VOLUME_DOWN_KEYS.has(key)
          ? -1
          : VOLUME_UP_KEYS.has(key)
            ? 1
            : 0;
        if (direction !== 0) {
          e.preventDefault();
          stepVolume(direction);
          return;
        }
      }

      if (e.repeat) return;

      // Below the repeat guard, unlike volume: each step writes localStorage and
      // a Tauri IPC call, so a held arrow key must not fire 30 times a second.
      if (!bound && !e.ctrlKey && (key === "arrowup" || key === "arrowdown")) {
        e.preventDefault();
        stepSpeed(key === "arrowup" ? 1 : -1);
        return;
      }

      if (e.ctrlKey && e.shiftKey && key === "d" && !e.altKey) {
        const el = e.target as HTMLElement | null;
        if (el?.closest?.("input, textarea, [contenteditable=true]")) {
          return;
        }
        e.preventDefault();
        toggleSpotifyDebugPanel();
        return;
      }

      if (eventMatchesPlayKey(e, playKeybind)) {
        primeHitSound();
        const { phase, playback } = useGameStore.getState();
        // Mode 1 (My Library): the game owns the audio, so the play key is a real
        // transport pause — the more useful thing to have under your thumb than
        // the autoplay toggle, which lane keys and the AFK switch already reach.
        // Mode 2 keeps the toggle: pausing Spotify belongs to the Spotify client.
        if (playback?.source === "server") {
          if (phase === "autoplay" || phase === "manual" || phase === "paused") {
            e.preventDefault();
            toggleServerTransport(phase === "paused");
          }
          return;
        }
        if (phase === "autoplay" || phase === "manual") {
          e.preventDefault();
          togglePlayMode();
        }
        return;
      }

      const laneIndex = laneKeys.findIndex((k) => k.toLowerCase() === key);
      if (laneIndex < 0) return;
      primeHitSound();

      const { phase, chart } = useGameStore.getState();
      if (!chart || (phase !== "autoplay" && phase !== "manual")) return;

      e.preventDefault();
      if (phase === "autoplay") {
        togglePlayMode();
      }
      dispatchLaneDown(laneIndex);
      dispatchLaneHit(laneIndex);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!document.hasFocus()) return;
      if (useGameStore.getState().calibrationActive) return;
      const targetEl = e.target as HTMLElement | null;
      if (
        targetEl?.closest?.("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (e.metaKey || e.altKey) return;
      const laneIndex = laneKeys.findIndex((k) => k.toLowerCase() === key);
      if (laneIndex < 0) return;

      const { phase, chart } = useGameStore.getState();
      if (phase !== "manual" || !chart) return;
      dispatchLaneUp(laneIndex);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [settings, togglePlayMode]);
}
