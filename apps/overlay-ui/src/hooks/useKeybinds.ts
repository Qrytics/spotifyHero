import { useEffect } from "react";
import { useGameStore } from "../store/gameStore.js";
import { toggleSpotifyDebugPanel } from "../lib/spotifyDiagnostics.js";
import { eventMatchesPlayKey } from "../lib/keybindDisplay.js";

/**
 * useKeybinds
 *
 * Registers global keyboard listeners for:
 *   - Play/Autoplay toggle (Space by default)
 *   - Lane inputs (d, f, j, k by default) in manual mode
 */
export function useKeybinds(): void {
  const settings = useGameStore((s) => s.settings);
  const togglePlayMode = useGameStore((s) => s.togglePlayMode);
  const phase = useGameStore((s) => s.phase);
  const chart = useGameStore((s) => s.chart);

  useEffect(() => {
    const { playKeybind, laneKeys } = settings;

    const onKeyDown = (e: KeyboardEvent) => {
      // Prevent key repeat spam
      if (e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      const key = e.key.toLowerCase();

      if (e.ctrlKey && e.shiftKey && key === "d" && !e.altKey) {
        const el = e.target as HTMLElement | null;
        if (el?.closest?.("input, textarea, [contenteditable=true]")) {
          return;
        }
        e.preventDefault();
        toggleSpotifyDebugPanel();
        return;
      }

      // Toggle autoplay ↔ manual (Space must match ev.code / ev.key)
      if (eventMatchesPlayKey(e, playKeybind)) {
        if (phase === "autoplay" || phase === "manual") {
          e.preventDefault();
          togglePlayMode();
        }
        return;
      }

      // Lane hits in manual mode
      if (phase === "manual" && chart) {
        const laneIndex = laneKeys.findIndex(
          (k) => k.toLowerCase() === key
        );
        if (laneIndex >= 0) {
          window.dispatchEvent(
            new CustomEvent("spotifyhero:lanedown", {
              detail: { lane: laneIndex },
            })
          );
          window.dispatchEvent(
            new CustomEvent("spotifyhero:lanehit", {
              detail: { lane: laneIndex, timeMs: Date.now() },
            })
          );
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      const key = e.key.toLowerCase();

      if (phase === "manual" && chart) {
        const laneIndex = laneKeys.findIndex(
          (k) => k.toLowerCase() === key
        );
        if (laneIndex >= 0) {
          window.dispatchEvent(
            new CustomEvent("spotifyhero:laneup", {
              detail: { lane: laneIndex },
            })
          );
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [settings, phase, chart, togglePlayMode]);
}
