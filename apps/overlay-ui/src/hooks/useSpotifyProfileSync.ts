import { useEffect } from "react";
import { useGameStore, type SpotifyUserProfile } from "../store/gameStore.js";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Loads Spotify display name / id from the desktop shell for leaderboard name + `spotify_user_id`.
 * Re-run periodically so a reconnect after scope upgrade picks up profile.
 */
export function useSpotifyProfileSync(): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;
    const tick = async (): Promise<void> => {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const p = await invoke<SpotifyUserProfile | null>("get_spotify_user_profile");
        if (cancelled) return;
        useGameStore.getState().setSpotifyUser(p);
        const name = p?.displayName?.trim();
        if (name) {
          useGameStore.getState().updateSettings({ playerName: name.slice(0, 32) });
        }
      } catch {
        useGameStore.getState().setSpotifyUser(null);
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 22_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
}
