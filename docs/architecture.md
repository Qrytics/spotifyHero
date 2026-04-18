# spotifyHero – System Architecture

## High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Spotify (external)                                             │
│    ─ Web API /me/player/currently-playing                       │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP (polled every 500 ms)
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  apps/desktop  (Tauri 2 + Rust)                                │
│                                                                │
│  spotify.rs  ─→  commands.rs  ─→  IPC invoke()                 │
│  settings.rs (persisted JSON via tauri-plugin-store)           │
│  global-shortcut plugin                                        │
└────────────────────────┬───────────────────────────────────────┘
                         │ Tauri IPC (invoke / emit)
                         ▼
┌───────────────────────────────────────────────────────────────┐
│  apps/overlay-ui  (React + PixiJS running in Tauri WebView)   │
│                                                               │
│  useSpotifySync() ─→ DriftCorrector ─→ store.setPlayback()    │
│  HybridChartGenerator ─→ store.setChart()                     │
│  useGameLoop() ─→ ScoringEngine + NoteWindowManager           │
│  useKeybinds() ─→ lane hits / mode toggle                     │
│                                                               │
│  NoteHighway (PixiJS Canvas)                                  │
│  HUD / ResultsScreen / IdleScreen (React DOM)                 │
└───────────────────────┬───────────────────────────────────────┘
                        │ fetch / supabase REST
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  services/leaderboard  (Supabase Postgres + Auth)            │
│    table: leaderboard_entries                                │
└──────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Responsibility |
|---------|---------------|
| `apps/desktop` | Tauri shell: native window, OAuth, Spotify polling |
| `apps/overlay-ui` | React + PixiJS: note highway, HUD, game state |
| `packages/shared-types` | Zod schemas + TypeScript types (shared boundary) |
| `packages/gameplay-core` | ScoringEngine, hit windows, combo, mode controller |
| `packages/audio-engine` | Drift correction, MockSpotifyPoller interface |
| `packages/chart-generator` | Deterministic + ML hybrid charting pipeline |
| `packages/leaderboard-client` | Supabase REST + offline fallback |

## Key Design Decisions

### Hybrid chart generation
Notes are generated in two passes:
1. **Deterministic** – onset/beat events → density filter → lane assignment.
2. **ML refinement** – ONNX model via Rust improves note quality; if model confidence < 0.65 the deterministic chart is used.

### Latency / drift correction
Spotify's Web API position reports lag by ~50-100 ms and drift over time.
`DriftCorrector` (audio-engine) maintains a running reference wall clock and corrects the reported position on every update.

### Always-on-top overlay window
Configured in `tauri.conf.json` (`alwaysOnTop: true`) and toggleable at runtime via the `set_always_on_top` command. Window geometry is persisted via `tauri-plugin-store`.

### Offline-first
All core gameplay (chart generation, scoring) works without network.
Leaderboards and challenges require a Supabase endpoint; the `OfflineLeaderboardClient` provides a local-only fallback.
