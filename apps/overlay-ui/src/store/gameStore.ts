import { create } from "zustand";
import type {
  AppSettings,
  Chart,
  GameSession,
  PlaybackState,
  ScoreEvent,
} from "@spotifyhero/shared-types";
import { AppSettingsSchema } from "@spotifyhero/shared-types";
import type { PlayMode } from "@spotifyhero/gameplay-core";

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

function settingsFromEnv(): AppSettings {
  const persisted = loadPersistedSettings();
  const patch: Record<string, unknown> = persisted ? { ...persisted } : {};
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url) patch.supabaseUrl = url;
  if (key) patch.supabaseAnonKey = key;
  return AppSettingsSchema.parse(patch);
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

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface GameState {
  phase: GamePhase;
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
  session: GameSession | null;

  // Actions
  setPhase: (phase: GamePhase) => void;
  setPlayback: (state: PlaybackState) => void;
  setChart: (chart: Chart) => void;
  onScoreEvent: (event: ScoreEvent, totalNotes: number) => void;
  setSession: (session: GameSession) => void;
  togglePlayMode: () => PlayMode;
  resetRound: () => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGameStore = create<GameState>((set, get) => ({
  phase: "idle",
  playback: null,
  chart: null,
  settings: settingsFromEnv(),
  lastPlayPhase: settingsFromEnv().autoplay ? "autoplay" : "manual",
  sessionPlayMode: null,
  score: 0,
  combo: 0,
  maxCombo: 0,
  accuracy: 1,
  lastScoreEvent: null,
  session: null,

  setPhase: (phase) => set({ phase }),

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
        set({ phase: "paused" });
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
        score: 0,
        combo: 0,
        maxCombo: 0,
        accuracy: 1,
        lastScoreEvent: null,
        session: null,
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
        lastPlayPhase:
          playPhase === "autoplay" || playPhase === "manual"
            ? playPhase
            : get().lastPlayPhase,
      });
    } else if (phaseNow === "idle") {
      set({
        phase: playPhase,
        lastPlayPhase:
          playPhase === "autoplay" || playPhase === "manual"
            ? playPhase
            : get().lastPlayPhase,
      });
    }
  },

  setChart: (chart) =>
    set((state) => {
      const keepExistingChart =
        state.chart &&
        state.chart.trackId === chart.trackId &&
        state.chart.difficulty === chart.difficulty;
      const phase: GamePhase =
        state.sessionPlayMode ??
        (state.settings.autoplay ? "autoplay" : "manual");
      const nextLast =
        phase === "autoplay" || phase === "manual" ? phase : state.lastPlayPhase;
      return {
        chart: keepExistingChart ? state.chart : chart,
        phase,
        sessionPlayMode: null,
        lastPlayPhase: nextLast,
      };
    }),

  onScoreEvent: (event, totalNotes) =>
    set((state) => {
      const pts = Number(event.pointsAwarded);
      const awarded = Number.isFinite(pts) ? pts : 0;
      const nextScore =
        event.judgement !== "miss" ? state.score + awarded : state.score;
      const combo = Number.isFinite(event.combo) ? event.combo : 0;
      const maxCombo = Math.max(state.maxCombo, combo);
      return {
        score: nextScore,
        combo,
        maxCombo,
        accuracy: state.accuracy,
        lastScoreEvent: event,
      };
    }),

  setSession: (session) => set({ session, phase: "results" }),

  togglePlayMode: () => {
    const current = get().phase;
    const next: GamePhase = current === "autoplay" ? "manual" : "autoplay";
    set({
      phase: next,
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
      session: null,
      chart: null,
      phase: "idle",
      sessionPlayMode: null,
      lastPlayPhase: state.settings.autoplay ? "autoplay" : "manual",
    })),

  updateSettings: (patch) =>
    set((state) => {
      const settings = AppSettingsSchema.parse({
        ...state.settings,
        ...patch,
      });
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* private mode / quota */
      }
      return {
        settings,
        ...(patch.autoplay !== undefined
          ? {
              lastPlayPhase: settings.autoplay ? "autoplay" : "manual",
            }
          : {}),
      };
    }),
}));
