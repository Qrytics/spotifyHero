import { useEffect } from "react";
import { useGameStore } from "../store/gameStore.js";
import { toggleSpotifyDebugPanel } from "../lib/spotifyDiagnostics.js";
import { eventMatchesPlayKey } from "../lib/keybindDisplay.js";
import { primeHitSound } from "../lib/hitSound.js";

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
 * Registers global keyboard listeners for:
 *   - Optional play key: toggles autoplay ↔ manual (default Space)
 *   - Lane keys: play hits; first press in autoplay switches to manual (no play key needed)
 */
export function useKeybinds(): void {
  const settings = useGameStore((s) => s.settings);
  const togglePlayMode = useGameStore((s) => s.togglePlayMode);

  useEffect(() => {
    const { playKeybind, laneKeys } = settings;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
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
        const { phase } = useGameStore.getState();
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
