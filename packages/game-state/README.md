# @spotifyhero/game-state

Zustand game store for spotifyHero. Holds all runtime state: game phase, playback, chart, scoring, and app settings.

## What's in here

- `useGameStore` — the single Zustand store
- `GamePhase` / `TrackLifecycleState` — phase enums
- `SpotifyUserProfile` — profile type
- `registerGameStoreSideEffects(effects)` — inject Tauri and audio callbacks
- `patchGameStoreFromEnv(overrides)` — apply build-time env var overrides (Supabase URL/key)

## Why a separate package?

The store contains **pure logic** — Zustand + Zod schemas — with no dependency on React, the Tauri shell, or the Canvas renderer. Extracting it as a workspace package means:

- The Tauri desktop layer can consume game state without bundling the full UI
- Future headless test runners and alternative front-ends (mobile, web) can share the same state model
- Side effects (Tauri native calls, audio feedback) are injected by the consumer, keeping the package portable

## Usage

```ts
// In the consuming app (e.g. overlay-ui):
import { registerGameStoreSideEffects, patchGameStoreFromEnv, useGameStore } from "@spotifyhero/game-state";
import { saveTauriAppSettings, setTauriAlwaysOnTop } from "./lib/tauriSettings.js";
import { playScoreEventSfx } from "./lib/hitSound.js";

// Register platform side effects once at app init
registerGameStoreSideEffects({ saveTauriAppSettings, setTauriAlwaysOnTop, playScoreEventSfx });

// Patch in env vars (Vite / build-time values)
patchGameStoreFromEnv({
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// Use the store anywhere
const phase = useGameStore((s) => s.phase);
```
