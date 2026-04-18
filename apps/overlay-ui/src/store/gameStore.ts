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

function settingsFromEnv(): AppSettings {
  const patch: Partial<AppSettings> = {};
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
  score: 0,
  combo: 0,
  maxCombo: 0,
  accuracy: 1,
  lastScoreEvent: null,
  session: null,

  setPhase: (phase) => set({ phase }),

  setPlayback: (playback) => {
    const current = get().playback;
    const changed =
      !current ||
      current.isPlaying !== playback.isPlaying ||
      current.trackId !== playback.trackId;

    set({ playback });

    if (changed && playback.isPlaying && playback.trackId) {
      // New track started → trigger chart generation (handled by hook)
      set({ phase: "loading" });
    } else if (!playback.isPlaying) {
      const phase = get().phase;
      if (phase === "autoplay" || phase === "manual") {
        set({ phase: "paused" });
      }
    }
  },

  setChart: (chart) =>
    set({ chart, phase: get().settings.autoplay ? "autoplay" : "manual" }),

  onScoreEvent: (event, totalNotes) =>
    set((state) => {
      const hits =
        event.judgement !== "miss" ? state.score + event.pointsAwarded : state.score;
      const combo =
        event.judgement !== "miss" && event.judgement !== "bad"
          ? state.combo + 1
          : 0;
      const maxCombo = Math.max(state.maxCombo, combo);
      // Running accuracy: (perfects weighted 1 + greats weighted 0.75) / total
      const accuracy = state.accuracy; // refined by ScoringEngine.finalize()
      return {
        score: hits,
        combo,
        maxCombo,
        accuracy,
        lastScoreEvent: event,
      };
    }),

  setSession: (session) => set({ session, phase: "results" }),

  togglePlayMode: () => {
    const current = get().phase;
    const next: GamePhase = current === "autoplay" ? "manual" : "autoplay";
    set({ phase: next });
    return next === "autoplay" ? "autoplay" : "manual";
  },

  resetRound: () =>
    set({
      score: 0,
      combo: 0,
      maxCombo: 0,
      accuracy: 1,
      lastScoreEvent: null,
      session: null,
      chart: null,
      phase: "idle",
    }),

  updateSettings: (patch) =>
    set((state) => ({
      settings: { ...state.settings, ...patch },
    })),
}));
