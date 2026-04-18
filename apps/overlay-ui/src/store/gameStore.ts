import { create } from "zustand";
import { normalizeSupabaseProjectUrl } from "@spotifyhero/leaderboard-client";
import type {
  AppSettings,
  Chart,
  GameSession,
  PlaybackState,
  ScoreEvent,
} from "@spotifyhero/shared-types";
import { AppSettingsSchema } from "@spotifyhero/shared-types";

export type SpotifyUserProfile = {
  id: string;
  displayName: string;
  email: string | null;
};
import type { PlayMode } from "@spotifyhero/gameplay-core";
import { saveTauriAppSettings } from "../lib/tauriSettings.js";
import { playHitFinishSfx } from "../lib/hitSound.js";

const SETTINGS_STORAGE_KEY = "spotifyHero_settings_v1";

function loadPersistedSettings(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function finalizeSupabaseUrlInSettings(settings: AppSettings): AppSettings {
  if (!settings.supabaseUrl) return settings;
  const u = normalizeSupabaseProjectUrl(settings.supabaseUrl);
  return u === settings.supabaseUrl ? settings : { ...settings, supabaseUrl: u };
}

function settingsFromEnv(): AppSettings {
  const persisted = loadPersistedSettings();
  const patch: Record<string, unknown> = persisted ? { ...persisted } : {};
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url) patch.supabaseUrl = url;
  if (key) patch.supabaseAnonKey = key;
  return finalizeSupabaseUrlInSettings(AppSettingsSchema.parse(patch));
}

// ---------------------------------------------------------------------------
// Game phase
// ---------------------------------------------------------------------------

export type GamePhase =
  | "idle"           // No song playing, waiting
  | "loading"        // Chart is being generated
  | "autoplay"       // Playing automatically
  | "manual"         // Player is in control
  | "paused"         // Game is paused / Spotify paused
  | "results";       // Session finished, showing scores

export const TRACK_LIFECYCLE_STATES = [
  "idle",
  "loading",
  "generating",
  "countdown",
  "playing",
  "ending",
] as const;
export type TrackLifecycleState = (typeof TRACK_LIFECYCLE_STATES)[number];

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface GameState {
  phase: GamePhase;
  trackLifecycle: TrackLifecycleState;
  countdownUntilMs: number | null;
  playback: PlaybackState | null;
  chart: Chart | null;
  settings: AppSettings;
  /**
   * Last interactive autoplay ↔ manual choice (survives `paused`; used when a new
   * chart loads so we don't revert to settings.autoplay alone).
   */
  lastPlayPhase: "autoplay" | "manual";
  /**
   * When switching tracks while playing/paused, prefer this for the next chart phase.
   * Consumed by `setChart`; if null, falls back to `settings.autoplay`.
   */
  sessionPlayMode: "autoplay" | "manual" | null;
  score: number;
  combo: number;
  maxCombo: number;
  accuracy: number;
  lastScoreEvent: ScoreEvent | null;
  /** Last `onScoreEvents` payload — highway applies visibility for every event in one store tick. */
  lastScoreEventBatch: readonly ScoreEvent[] | null;
  /** Bumps when `lastScoreEventBatch` changes so subscribers avoid string compares. */
  scoreEventSeq: number;
  session: GameSession | null;
  usedAutoplayThisRound: boolean;
  /** From Tauri `get_spotify_user_profile` — drive name + leaderboard `spotify_user_id`. */
  spotifyUser: SpotifyUserProfile | null;
  /** True while timing calibrator is open — pauses scoring loop and lane keybinds. */
  calibrationActive: boolean;

  // Actions
  setPhase: (phase: GamePhase) => void;
  setPlayback: (state: PlaybackState) => void;
  setChart: (chart: Chart) => void;
  onScoreEvent: (event: ScoreEvent, totalNotes: number) => void;
  /** Apply many scoring events in one `set()` — fewer React re-renders per frame than repeated `onScoreEvent`. */
  onScoreEvents: (events: readonly ScoreEvent[], totalNotes: number) => void;
  setSession: (session: GameSession) => void;
  togglePlayMode: () => PlayMode;
  resetRound: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setSpotifyUser: (user: SpotifyUserProfile | null) => void;
  setCalibrationActive: (active: boolean) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialSettings = settingsFromEnv();

export const useGameStore = create<GameState>((set, get) => ({
  phase: "idle",
  trackLifecycle: "idle",
  countdownUntilMs: null,
  playback: null,
  chart: null,
  settings: initialSettings,
  lastPlayPhase: initialSettings.autoplay ? "autoplay" : "manual",
  sessionPlayMode: null,
  score: 0,
  combo: 0,
  maxCombo: 0,
  accuracy: 1,
  lastScoreEvent: null,
  lastScoreEventBatch: null,
  scoreEventSeq: 0,
  session: null,
  usedAutoplayThisRound: false,
  spotifyUser: null,
  calibrationActive: false,

  setCalibrationActive: (active) => set({ calibrationActive: active }),

  setPhase: (phase) => {
    const trackLifecycle: TrackLifecycleState =
      phase === "loading"
        ? "loading"
        : phase === "results"
          ? "ending"
          : phase === "idle"
            ? "idle"
            : "playing";
    set({ phase, trackLifecycle });
  },

  setPlayback: (playback) => {
    const prevTrackId = get().playback?.trackId ?? null;
    const nextTrackId = playback.trackId;
    const chartTrackId = get().chart?.trackId ?? null;
    const baselineTrackId = chartTrackId ?? prevTrackId;
    const trackChanged =
      Boolean(nextTrackId) &&
      Boolean(baselineTrackId) &&
      baselineTrackId !== nextTrackId;

    set({ playback });

    if (!playback.isPlaying || !nextTrackId) {
      const phase = get().phase;
      if (phase === "autoplay" || phase === "manual") {
        set({ phase: "paused", trackLifecycle: "ending" });
      }
      return;
    }

    const chart = get().chart;
    const chartMatches = chart?.trackId === nextTrackId;
    const needsNewChart =
      Boolean(nextTrackId) && (!chart || !chartMatches || trackChanged);

    if (needsNewChart) {
      if (get().phase === "loading" && !trackChanged) {
        return;
      }
      const st = get();
      let inherit: "autoplay" | "manual" | null = null;
      if (st.phase === "autoplay" || st.phase === "manual") {
        inherit = st.phase;
      } else if (st.phase === "paused") {
        inherit = st.lastPlayPhase;
      } else if (st.phase === "results") {
        inherit = st.lastPlayPhase;
      }

      set({
        phase: "loading",
        trackLifecycle: "loading",
          countdownUntilMs: null,
        chart: null,
        score: 0,
        combo: 0,
        maxCombo: 0,
        accuracy: 1,
        lastScoreEvent: null,
        lastScoreEventBatch: null,
        scoreEventSeq: 0,
        session: null,
        usedAutoplayThisRound: false,
        sessionPlayMode: inherit,
      });
      return;
    }

    const phaseNow = get().phase;
    const preferAutoplay = get().settings.autoplay;
    const playPhase: GamePhase = preferAutoplay ? "autoplay" : "manual";

    if (phaseNow === "paused") {
      set({
        phase: playPhase,
        trackLifecycle: "playing",
        lastPlayPhase:
          playPhase === "autoplay" || playPhase === "manual"
            ? playPhase
            : get().lastPlayPhase,
      });
    } else if (phaseNow === "idle") {
      set({
        phase: playPhase,
        trackLifecycle: "playing",
        lastPlayPhase:
          playPhase === "autoplay" || playPhase === "manual"
            ? playPhase
            : get().lastPlayPhase,
      });
    }
  },

  setChart: (chart) =>
    set((state) => {
      const phase: GamePhase =
        state.sessionPlayMode ??
        (state.settings.autoplay ? "autoplay" : "manual");
      const nextLast =
        phase === "autoplay" || phase === "manual" ? phase : state.lastPlayPhase;
      return {
        chart,
        phase,
        trackLifecycle: "playing",
        countdownUntilMs: null,
        sessionPlayMode: null,
        lastPlayPhase: nextLast,
      };
    }),

  onScoreEvent: (event, totalNotes) => {
    get().onScoreEvents([event], totalNotes);
  },

  onScoreEvents: (events, _totalNotes) => {
    if (events.length === 0) return;
    const st = get();
    const currentTrackId = st.chart?.trackId;
    const playbackTrackId = st.playback?.trackId ?? null;
    if (!currentTrackId || playbackTrackId !== currentTrackId) {
      return;
    }
    if (st.phase !== "autoplay") {
      for (const e of events) {
        playHitFinishSfx(e);
      }
    }
    set((state) => {
      let score = state.score;
      let combo = state.combo;
      let maxCombo = state.maxCombo;
      for (const event of events) {
        const pts = Number(event.pointsAwarded);
        const awarded = Number.isFinite(pts) ? pts : 0;
        score = event.judgement !== "miss" ? score + awarded : score;
        const c = Number.isFinite(event.combo) ? event.combo : 0;
        combo = c;
        maxCombo = Math.max(maxCombo, c);
      }
      const last = events[events.length - 1]!;
      return {
        score,
        combo,
        maxCombo,
        accuracy: state.accuracy,
        lastScoreEvent: last,
        lastScoreEventBatch: events,
        scoreEventSeq: state.scoreEventSeq + 1,
      };
    });
  },

  setSession: (session) =>
    set({ session, phase: "results", trackLifecycle: "ending", countdownUntilMs: null }),

  togglePlayMode: () => {
    const current = get().phase;
    const next: GamePhase = current === "autoplay" ? "manual" : "autoplay";
    set({
      phase: next,
      trackLifecycle: "playing",
      lastPlayPhase:
        next === "autoplay" || next === "manual" ? next : get().lastPlayPhase,
    });
    return next === "autoplay" ? "autoplay" : "manual";
  },

  resetRound: () =>
    set((state) => ({
      score: 0,
      combo: 0,
      maxCombo: 0,
      accuracy: 1,
      lastScoreEvent: null,
      lastScoreEventBatch: null,
      scoreEventSeq: 0,
      session: null,
      usedAutoplayThisRound: false,
      chart: null,
      phase: "idle",
      trackLifecycle: "idle",
      countdownUntilMs: null,
      sessionPlayMode: null,
      lastPlayPhase: state.settings.autoplay ? "autoplay" : "manual",
    })),

  updateSettings: (patch) =>
    set((state) => {
      const settings = finalizeSupabaseUrlInSettings(
        AppSettingsSchema.parse({
          ...state.settings,
          ...patch,
        })
      );

      const difficultyRegen =
        patch.difficulty !== undefined &&
        patch.difficulty !== state.settings.difficulty &&
        state.chart !== null &&
        state.playback?.trackId != null &&
        state.chart.trackId === state.playback.trackId &&
        (state.phase === "autoplay" ||
          state.phase === "manual" ||
          state.phase === "paused");

      let regenPatch: Partial<GameState> = {};
      if (difficultyRegen) {
        let inherit: "autoplay" | "manual" | null = null;
        if (state.phase === "autoplay" || state.phase === "manual") {
          inherit = state.phase;
        } else if (state.phase === "paused") {
          inherit = state.lastPlayPhase;
        }
        regenPatch = {
          phase: "loading",
          trackLifecycle: "loading",
          chart: null,
          score: 0,
          combo: 0,
          maxCombo: 0,
          accuracy: 1,
          lastScoreEvent: null,
          lastScoreEventBatch: null,
          scoreEventSeq: 0,
          session: null,
          usedAutoplayThisRound: false,
          sessionPlayMode: inherit,
        };
      }

      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* private mode / quota */
      }
      void saveTauriAppSettings({
        noteScrollSpeed: settings.noteScrollSpeed,
        playbackTimingOffsetMs: settings.playbackTimingOffsetMs,
        spotifyClientId: settings.spotifyClientId ?? null,
      });
      return {
        settings,
        ...regenPatch,
        ...(patch.autoplay !== undefined
          ? {
              lastPlayPhase: settings.autoplay ? "autoplay" : "manual",
            }
          : {}),
      };
    }),
  setSpotifyUser: (spotifyUser) => set({ spotifyUser }),
}));
