import { invoke } from "@tauri-apps/api/core";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pauseSpotifyPlayback(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("spotify_pause_playback");
  } catch {
    // Best-effort only; countdown still works if API command fails.
  }
}

export async function resumeSpotifyPlayback(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("spotify_resume_playback");
  } catch {
    // Best-effort only; countdown still works if API command fails.
  }
}
