import { invoke } from "@tauri-apps/api/core";

type TauriAppSettingsPayload = {
  noteScrollSpeed: number;
  playbackTimingOffsetMs: number;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadTauriAppSettings(): Promise<TauriAppSettingsPayload | null> {
  if (!isTauriRuntime()) return null;
  try {
    const payload = await invoke<TauriAppSettingsPayload>("load_app_settings");
    if (!Number.isFinite(payload.noteScrollSpeed)) return null;
    const o = payload.playbackTimingOffsetMs;
    if (typeof o === "number" && Number.isFinite(o)) {
      return payload;
    }
    return { ...payload, playbackTimingOffsetMs: 0 };
  } catch {
    return null;
  }
}

export async function saveTauriAppSettings(payload: TauriAppSettingsPayload): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_app_settings", { payload });
}
