import { invoke } from "@tauri-apps/api/core";

type TauriAppSettingsPayload = {
  alwaysOnTop: boolean;
  noteScrollSpeed: number;
  playbackTimingOffsetMs: number;
  visualNoteOffsetMs: number;
  spotifyClientId?: string | null;
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
    if (
      typeof o === "number" &&
      Number.isFinite(o) &&
      typeof payload.alwaysOnTop === "boolean" &&
      typeof payload.visualNoteOffsetMs === "number" &&
      Number.isFinite(payload.visualNoteOffsetMs)
    ) {
      return payload;
    }
    return {
      ...payload,
      alwaysOnTop: payload.alwaysOnTop ?? true,
      playbackTimingOffsetMs: 0,
      visualNoteOffsetMs: 0,
    };
  } catch {
    return null;
  }
}

export async function saveTauriAppSettings(payload: TauriAppSettingsPayload): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("save_app_settings", {
    payload: {
      noteScrollSpeed: payload.noteScrollSpeed,
      alwaysOnTop: payload.alwaysOnTop,
      playbackTimingOffsetMs: payload.playbackTimingOffsetMs,
      visualNoteOffsetMs: payload.visualNoteOffsetMs,
      spotifyClientId: payload.spotifyClientId ?? null,
    },
  });
}

export async function setTauriAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_always_on_top", { enabled });
}
