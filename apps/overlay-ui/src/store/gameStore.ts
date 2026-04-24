/**
 * Re-export the game store from the @spotifyhero/game-state package and
 * register the overlay-ui's platform-specific side effects (Tauri native
 * calls and audio feedback).
 *
 * All components and hooks inside overlay-ui continue to import from this
 * file — the path is unchanged. The actual store logic lives in the package.
 */
export {
  useGameStore,
  patchGameStoreFromEnv,
  registerGameStoreSideEffects,
  TRACK_LIFECYCLE_STATES,
} from "@spotifyhero/game-state";
export type {
  GamePhase,
  TrackLifecycleState,
  SpotifyUserProfile,
  GameStoreSideEffects,
} from "@spotifyhero/game-state";

import { registerGameStoreSideEffects, patchGameStoreFromEnv } from "@spotifyhero/game-state";
import { saveTauriAppSettings, setTauriAlwaysOnTop } from "../lib/tauriSettings.js";
import { playScoreEventSfx } from "../lib/hitSound.js";

// Register Tauri + audio side effects once at module load time.
registerGameStoreSideEffects({ saveTauriAppSettings, setTauriAlwaysOnTop, playScoreEventSfx });

// Apply Vite build-time env var overrides (Supabase credentials).
const _envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const _envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
patchGameStoreFromEnv({
  ...(_envUrl ? { supabaseUrl: _envUrl } : {}),
  ...(_envKey ? { supabaseAnonKey: _envKey } : {}),
});
