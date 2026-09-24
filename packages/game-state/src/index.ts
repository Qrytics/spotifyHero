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
import type { PlayMode } from "@spotifyhero/gameplay-core";
import { DIFFICULTY_SCROLL_SPEED } from "@spotifyhero/gameplay-core";

// ---------------------------------------------------------------------------
// Injectable side effects
// ---------------------------------------------------------------------------

type TauriAppSettingsPayload = {
  alwaysOnTop: boolean;
  noteScrollSpeed: number;
  playbackTimingOffsetMs: number;
  visualNoteOffsetMs: number;
  spotifyClientId?: string | null;
};

/**
 * Platform-specific callbacks injected by the consuming app (overlay-ui).
 * All callbacks are optional — the store works without them (dev/test environments).
 */
export type GameStoreSideEffects = {
  /** Persist settings to the Tauri native store. */
  saveTauriAppSettings?: (payload: TauriAppSettingsPayload) => void;
  /** Toggle the native always-on-top flag via Tauri. */
  setTauriAlwaysOnTop?: (enabled: boolean) => void;
  /** Play hit/miss audio feedback. */
  playScoreEventSfx?: (
    event: ScoreEvent,
    lane: number,
    prevCombo: number,
    pitchHz?: number
  ) => void;
};

let _sideEffects: GameStoreSideEffects = {};

/**
 * Register platform-specific side-effect callbacks.
 * Call once from the consuming app before any store actions are dispatched.
 */
export function registerGameStoreSideEffects(
  effects: GameStoreSideEffects
): void {
  _sideEffects = effects;
}

/**
 * Apply environment variable overrides (e.g. VITE_SUPABASE_URL).
 * Call from the consuming app after module init, passing values from the
 * build-time environment. This keeps `import.meta.env` out of the package.
 */
export function patchGameStoreFromEnv(overrides: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}): void {
  const { supabaseUrl, supabaseAnonKey } = overrides;
  if (!supabaseUrl && !supabaseAnonKey) return;
  const prev = useGameStore.getState().settings;
  const patch: Record<string, unknown> = { ...prev };
  if (supabaseUrl) patch.supabaseUrl = supabaseUrl;
  if (supabaseAnonKey) patch.supabaseAnonKey = supabaseAnonKey;
  useGameStore.setState({
    settings: finalizeSupabaseUrlInSettings(AppSettingsSchema.parse(patch)),
  });
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export type SpotifyUserProfile = {
  id: string;
  displayName: string;
  email: string | null;
};

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

function buildInitialSettings(): AppSettings {
  const persisted = loadPersistedSettings();
  const patch: Record<string, unknown> = persisted ? { ...persisted } : {};
  return finalizeSupabaseUrlInSettings(AppSettingsSchema.parse(patch));
}

// ---------------------------------------------------------------------------
// Game phase
// ---------------------------------------------------------------------------

export type GamePhase =
  | "idle"       // No song playing, waiting
  | "loading"    // Chart is being generated
  | "autoplay"   // Playing automatically
  | "manual"     // Player is in control
  | "paused"     // Game is paused / Spotify paused
  | "results";   // Session finished, showing scores

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
  lastComboMilestone: number;
  comboMilestoneSeq: number;
  comboBreakSeq: number;
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
  /**
   * 0–1 progress of the music-server track pipeline, or null when idle.
   * Rendered inside the existing `trackLifecycle === "generating"` branch —
   * deliberately **no** new `TrackLifecycleState`: `loading` = downloading and
   * `generating` = decode + analyse + chart is a correct reading of that enum.
   */
  analysisProgress: number | null;
  analysisStage:
    | "downloading"
    | "decoding"
    | "analyzing"
    | "charting"
    | null;

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
  /** Report music-server pipeline progress; pass `(null, null)` to clear. */
  setAnalysisProgress: (
    stage: GameState["analysisStage"],
    progress: number | null
  ) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialSettings = buildInitialSettings();

/**
 * Play mode a newly loading chart should carry over from the round it replaces —
 * the interactive autoplay ↔ manual choice outlives the chart it was made on.
 *
 * `null` means "no choice to carry over" (we were idle/loading/showing results),
 * and `setChart` then falls back to `settings.autoplay`.
 */
function inheritedPlayMode(
  state: Pick<GameState, "phase" | "lastPlayPhase">
): "autoplay" | "manual" | null {
  if (state.phase === "autoplay" || state.phase === "manual") return state.phase;
  if (state.phase === "paused") return state.lastPlayPhase;
  return null;
}

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
  lastComboMilestone: 0,
  comboMilestoneSeq: 0,
  comboBreakSeq: 0,
  accuracy: 1,
  lastScoreEvent: null,
  lastScoreEventBatch: null,
  scoreEventSeq: 0,
  session: null,
  usedAutoplayThisRound: false,
  spotifyUser: null,
  calibrationActive: false,
  analysisProgress: null,
  analysisStage: null,

  setCalibrationActive: (active) => set({ calibrationActive: active }),

  setAnalysisProgress: (analysisStage, analysisProgress) =>
    set({ analysisStage, analysisProgress }),

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
      set({
        phase: "loading",
        trackLifecycle: "loading",
          countdownUntilMs: null,
        chart: null,
        score: 0,
        combo: 0,
        maxCombo: 0,
        lastComboMilestone: 0,
        comboMilestoneSeq: 0,
        comboBreakSeq: 0,
        accuracy: 1,
        lastScoreEvent: null,
        lastScoreEventBatch: null,
        scoreEventSeq: 0,
        session: null,
        usedAutoplayThisRound: false,
        sessionPlayMode: inheritedPlayMode(get()),
      });
      return;
    }

    // Resuming an existing chart: back into the mode the player last chose.
    const phaseNow = get().phase;
    if (phaseNow === "paused" || phaseNow === "idle") {
      set({ phase: get().lastPlayPhase, trackLifecycle: "playing" });
    }
  },

  setChart: (chart) =>
    set((state) => {
      // The mode carried over from the previous round wins; with none to carry,
      // `settings.autoplay` decides. Hard-coding "autoplay" here is what used to
      // make that setting inert.
      const phase: "autoplay" | "manual" =
        state.sessionPlayMode ?? (state.settings.autoplay ? "autoplay" : "manual");
      return {
        chart,
        phase,
        trackLifecycle: "playing",
        countdownUntilMs: null,
        // Consumed — a later track change re-derives it from the live phase.
        sessionPlayMode: null,
        analysisProgress: null,
        analysisStage: null,
        lastPlayPhase: phase,
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
      let prevComboForSfx = st.combo;
      for (const e of events) {
        const note = st.chart?.notes[e.noteIndex];
        const lane = note?.lane ?? 0;
        _sideEffects.playScoreEventSfx?.(e, lane, prevComboForSfx, note?.pitchHz);
        prevComboForSfx = Number.isFinite(e.combo) ? e.combo : prevComboForSfx;
      }
    }
    set((state) => {
      let score = state.score;
      let combo = state.combo;
      let maxCombo = state.maxCombo;
      let lastComboMilestone = state.lastComboMilestone;
      let comboMilestoneSeq = state.comboMilestoneSeq;
      let comboBreakSeq = state.comboBreakSeq;
      let prevCombo = state.combo;
      for (const event of events) {
        const pts = Number(event.pointsAwarded);
        const awarded = Number.isFinite(pts) ? pts : 0;
        score = event.judgement !== "miss" ? score + awarded : score;
        const c = Number.isFinite(event.combo) ? event.combo : 0;
        const brokeCombo = prevCombo >= 2 && c === 0;
        const milestone = c > 0 && c % 25 === 0 && c > lastComboMilestone;
        if (milestone) {
          lastComboMilestone = c;
          comboMilestoneSeq += 1;
        }
        if (brokeCombo) {
          comboBreakSeq += 1;
        }
        combo = c;
        maxCombo = Math.max(maxCombo, c);
        prevCombo = c;
      }
      const last = events[events.length - 1]!;
      return {
        score,
        combo,
        maxCombo,
        lastComboMilestone,
        comboMilestoneSeq,
        comboBreakSeq,
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
      lastComboMilestone: 0,
      comboMilestoneSeq: 0,
      comboBreakSeq: 0,
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
      analysisProgress: null,
      analysisStage: null,
      lastPlayPhase: state.settings.autoplay ? "autoplay" : "manual",
    })),

  updateSettings: (patch) =>
    set((state) => {
      const difficultyChanged =
        patch.difficulty !== undefined &&
        patch.difficulty !== state.settings.difficulty;

      /**
       * Raising difficulty raises scroll speed with it — a denser chart at the
       * same speed is just cramped. Skipped when the caller sets a speed in the
       * same patch (the slider does), so this never fights an explicit value.
       */
      const speedForDifficulty =
        difficultyChanged &&
        patch.difficulty !== undefined &&
        patch.noteScrollSpeed === undefined
          ? DIFFICULTY_SCROLL_SPEED[patch.difficulty]
          : null;

      const settings = finalizeSupabaseUrlInSettings(
        AppSettingsSchema.parse({
          ...state.settings,
          ...patch,
          ...(speedForDifficulty !== null
            ? { noteScrollSpeed: speedForDifficulty }
            : {}),
        })
      );

      const difficultyRegen =
        difficultyChanged &&
        state.chart !== null &&
        state.playback?.trackId != null &&
        state.chart.trackId === state.playback.trackId &&
        (state.phase === "autoplay" ||
          state.phase === "manual" ||
          state.phase === "paused");

      let regenPatch: Partial<GameState> = {};
      if (difficultyRegen) {
        regenPatch = {
          phase: "loading",
          trackLifecycle: "loading",
          chart: null,
          score: 0,
          combo: 0,
          maxCombo: 0,
          lastComboMilestone: 0,
          comboMilestoneSeq: 0,
          comboBreakSeq: 0,
          accuracy: 1,
          lastScoreEvent: null,
          lastScoreEventBatch: null,
          scoreEventSeq: 0,
          session: null,
          usedAutoplayThisRound: false,
          sessionPlayMode: inheritedPlayMode(state),
        };
      }

      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* private mode / quota */
      }
      _sideEffects.saveTauriAppSettings?.({
        noteScrollSpeed: settings.noteScrollSpeed,
        alwaysOnTop: settings.window.alwaysOnTop,
        playbackTimingOffsetMs: settings.playbackTimingOffsetMs,
        visualNoteOffsetMs: (settings as AppSettings & { visualNoteOffsetMs?: number }).visualNoteOffsetMs ?? 0,
        spotifyClientId: settings.spotifyClientId ?? null,
      });
      if (patch.window?.alwaysOnTop !== undefined) {
        _sideEffects.setTauriAlwaysOnTop?.(settings.window.alwaysOnTop);
      }
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
