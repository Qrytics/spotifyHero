/** Latest Spotify poll outcome — also on `window.__spotifyHeroDiagnostics` for console copy. */

export const SPOTIFY_DEBUG_STORAGE_KEY = "spotifyHero_debug";

export type SpotifyPollDiagnostics = {
  updatedAt: string;
  invokeError: string | null;
  zodFlat: Record<string, unknown> | null;
  /** Last raw IPC payload (may be truncated for huge objects). */
  raw: unknown;
  parsed: {
    isPlaying: boolean;
    positionMs: number;
    trackId: string | null;
    trackName: string | null;
  } | null;
};

export function isSpotifyDebugPanelEnabled(): boolean {
  try {
    return localStorage.getItem(SPOTIFY_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function toggleSpotifyDebugPanel(): boolean {
  const next = !isSpotifyDebugPanelEnabled();
  try {
    localStorage.setItem(SPOTIFY_DEBUG_STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("spotifyhero-debug-toggle"));
  return next;
}

export function publishSpotifyDiagnostics(d: SpotifyPollDiagnostics): void {
  (window as Window & { __spotifyHeroDiagnostics?: SpotifyPollDiagnostics }).__spotifyHeroDiagnostics =
    d;
  window.dispatchEvent(
    new CustomEvent<SpotifyPollDiagnostics>("spotifyhero-diagnostics", { detail: d })
  );
}

/** Safe JSON preview for unknown IPC payloads (avoid freezing UI on huge blobs). */
export function truncateForDiagnostics(raw: unknown, maxChars = 8000): unknown {
  try {
    const s = JSON.stringify(raw);
    if (s.length <= maxChars) {
      return raw;
    }
    return {
      _truncated: true,
      length: s.length,
      preview: `${s.slice(0, maxChars)}…`,
    };
  } catch {
    return { _error: "not JSON-serializable", type: typeof raw };
  }
}

export function diagnosticsToClipboardText(d: SpotifyPollDiagnostics): string {
  return JSON.stringify(
    {
      app: "spotifyHero",
      ...d,
      hint: "Include this when reporting playback issues.",
    },
    null,
    2
  );
}
