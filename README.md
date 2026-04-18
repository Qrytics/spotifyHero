# spotifyHero

Desktop app that turns your Spotify tracks into a Friday Night Funkin' / Guitar Hero-style experience.

## Product goal
- User plays music in Spotify.
- spotifyHero creates a real-time note highway for that song.
- By default, notes autoplay.
- User can press a keybind to instantly switch into manual play.
- Includes scoring, leaderboards, and one-click challenge sharing.
- Game window is tiny, always-on-top, and minimizable.

## Recommended tech stack (for Itch.io now, Steam-ready later)
- **Desktop shell:** `Tauri 2 + Rust`
  - Small binary size, strong security defaults, good native window controls (always-on-top/minimize).
- **Game/UI:** `TypeScript + React + PixiJS`
  - Fast 2D rendering for rhythm lanes, easy iteration.
- **State & data:** `TypeScript + Zod + TanStack Query`
  - Typed contracts and predictable async data flow.
- **Backend service (leaderboards/challenges):** `Supabase` (Postgres + Auth + Realtime)
  - Fast MVP path; can later migrate behind a custom API if needed.
- **Audio capture + timing sync:** `Rust (cpal/rodio family)`
  - Low-latency native audio path and robust timing clocks.
- **Chart generation inference runtime:** `ONNX Runtime` (invoked from Rust)
  - Local, fast, no server round-trip required for core gameplay.

## Note auto-generation strategy (best practical approach)
Use a **hybrid pipeline** instead of pure ML-only:

1. **Signal-first extraction (always available)**
   - Beat/downbeat/onset detection from captured audio.
   - Difficulty scaling by density filtering + lane assignment rules.
2. **ML-assisted refinement (when confidence is high)**
   - Lightweight pretrained sequence model to improve note placement and phrasing.
   - Confidence gating: if model confidence is low, fall back to deterministic signal-based chart.
3. **Latency calibration + drift correction**
   - Runtime offset calibration per device.
   - Ongoing drift correction to keep notes aligned to Spotify playback.

Why this is best:
- Works offline, low infra cost.
- Deterministic fallback prevents broken charts.
- ML improves quality without making gameplay depend on remote inference.

## Window behavior requirements
Implement via Tauri window config + runtime controls:
- Start as a **small side window** (e.g. 360x640, user-resizable with minimum bounds).
- `alwaysOnTop = true` while game overlay is enabled.
- Supports **minimize** and restore from tray/taskbar.
- Optional click-through mode only when explicitly enabled (never default).
- Persist last window position/size between sessions.

## AI-agent-friendly repository architecture

```text
spotifyHero/
  apps/
    desktop/                 # Tauri app shell (Rust + webview host)
    overlay-ui/              # React + PixiJS note highway and HUD
  packages/
    audio-engine/            # Audio capture, beat tracking, sync clock abstractions
    chart-generator/         # Hybrid note generation pipeline + difficulty scaler
    gameplay-core/           # Scoring, hit windows, combos, modifiers
    leaderboard-client/      # API client + share/challenge payload builder
    shared-types/            # Shared schemas/types (Zod + TS)
  services/
    leaderboard/             # Optional serverless functions / API glue
  docs/
    architecture.md          # System architecture and data flow
    gameplay-spec.md         # Scoring/judgement rules
    integration-spec.md      # Spotify + platform integration behavior
    ai-agent-guide.md        # How agents should navigate, edit, validate
  scripts/
    setup/                   # Bootstrap scripts (non-product code)
```

## Readability/accessibility standards for AI agents
- Keep each package focused on one responsibility.
- Keep public interfaces in `index.ts` and avoid deep imports.
- Add a short `README.md` in each app/package with:
  - purpose
  - entrypoints
  - key commands
  - dependencies
- Enforce strict typing and schema validation at boundaries.
- Standardize commands at root:
  - `pnpm install`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
- Add `docs/ai-agent-guide.md` with:
  - repository map
  - safe edit zones
  - required validation commands
  - common troubleshooting notes

## Delivery roadmap (phased)
1. **Foundation**
   - Monorepo scaffolding, Tauri shell, overlay window controls, input handling.
2. **Gameplay MVP**
   - Highway renderer, autoplay/manual toggle keybind, scoring + combo.
3. **Chart generation v1**
   - Deterministic beat/onset charting + difficulty presets.
4. **Social loop**
   - Leaderboards, challenge links, song+score sharing.
5. **Chart generation v2**
   - ML refinement + confidence fallback.
6. **Distribution hardening**
   - Itch packaging first, then Steam build pipeline, telemetry/crash reporting.
7. **Documentation finalization**
   - Update the root `README.md` at the end of implementation to fully document architecture, gameplay flow, setup, run, and demo steps.

## Immediate next implementation tasks
- Initialize pnpm workspace with `apps/` + `packages/` layout.
- Scaffold Tauri desktop app and React/Pixi overlay UI.
- Implement tiny always-on-top overlay with minimize/persisted geometry.
- Add gameplay-core package with autoplay/manual toggle and scoring primitives.
- Add chart-generator deterministic baseline before ML refinement.
- Final pass: expand `README.md` with complete project explanation and exact demo/run instructions.
