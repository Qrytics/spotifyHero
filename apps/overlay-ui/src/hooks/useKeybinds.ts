import { useEffect } from "react";
import { useGameStore } from "../store/gameStore.js";

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
      const key = e.key.toLowerCase();

      // Toggle autoplay ↔ manual
      if (key === playKeybind.toLowerCase()) {
        if (phase === "autoplay" || phase === "manual") {
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
          // Dispatch custom event so the game loop can pick it up
          window.dispatchEvent(
            new CustomEvent("spotifyhero:lanehit", {
              detail: { lane: laneIndex, timeMs: Date.now() },
            })
          );
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings, phase, chart, togglePlayMode]);
}
