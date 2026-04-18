/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Set by `TauriSpotifyPoller` each poll — paste for debugging playback issues. */
interface SpotifyPollDiagnosticsGlobal {
  readonly updatedAt: string;
  readonly invokeError: string | null;
  readonly zodFlat: Record<string, unknown> | null;
  readonly raw: unknown;
  readonly parsed: {
    readonly isPlaying: boolean;
    readonly positionMs: number;
    readonly trackId: string | null;
    readonly trackName: string | null;
  } | null;
}

interface Window {
  __spotifyHeroDiagnostics?: SpotifyPollDiagnosticsGlobal;
}
