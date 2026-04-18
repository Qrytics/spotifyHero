# spotifyHero 🎵🎮

A desktop overlay game that turns whatever you're listening to on Spotify into a **Friday Night Funkin' / Guitar Hero-style note highway** displayed in a tiny always-on-top window alongside your screen.

Notes auto-play by default. Press a key to jump in and play yourself. Climb leaderboards, challenge friends on any song.

Available on [Itch.io](https://spotifyhero.itch.io) (now). Steam build pipeline planned.

---

## Table of Contents
1. [What it does](#what-it-does)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [How to demo it (fast path)](#how-to-demo-it-fast-path)
5. [Full development setup](#full-development-setup)
6. [Running the app](#running-the-app)
7. [Building for distribution](#building-for-distribution)
8. [How note generation works](#how-note-generation-works)
9. [Gameplay rules](#gameplay-rules)
10. [Configuration](#configuration)
11. [Leaderboards and sharing](#leaderboards-and-sharing)
12. [Contributing](#contributing)
13. [Project roadmap](#project-roadmap)

---

## What it does

- You open Spotify and play any song.
- spotifyHero detects the track, generates a note chart in real time, and displays a note highway in a **small floating window** (360×640 px by default) that stays above all other windows.
- The game **autoplays** by default — notes hit themselves, so you can watch the highway visualise your music.
- Press **Space** (configurable) to instantly switch to **manual play** — you hit the correct lane key when notes reach the hit line.
- Your score, combo, and accuracy are tracked. When the song ends, results are shown and your score is submitted to the leaderboard.
- One click generates a **challenge link** you can send to friends: they load the same song and try to beat your score.

---

## Tech stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop shell | **Tauri 2 + Rust** | Small binaries, strong security, native always-on-top window controls |
| Game / UI | **React + PixiJS** | Fast 2D canvas rendering for the note highway; React for HUD + menus |
| State | **Zustand + Zod** | Minimal, typed, predictable game state |
| Audio sync | **Rust (cpal family)** via Tauri IPC | Low-latency capture, robust timing clocks |
| Chart generation | Hybrid: deterministic + **ONNX Runtime** (Rust) | Works offline; ML refines quality without requiring server inference |
| Leaderboards | **Supabase** (Postgres + Auth) | Fast MVP; can migrate to custom API later |
| Package manager | **pnpm workspaces** | Fast installs, strict dependency isolation |

---

## Repository layout

```
spotifyHero/
├── apps/
│   ├── desktop/          Tauri 2 Rust shell – native window, Spotify OAuth, IPC
│   └── overlay-ui/       React + PixiJS note highway and HUD
├── packages/
│   ├── shared-types/     Zod schemas + TypeScript types (shared data contracts)
│   ├── gameplay-core/    Scoring engine, hit windows, combo, mode toggle
│   ├── audio-engine/     Spotify poller interface, drift correction utilities
│   ├── chart-generator/  Hybrid note generation pipeline
│   └── leaderboard-client/ Supabase REST + offline fallback
├── services/
│   └── leaderboard/      (Future) serverless functions / Supabase migrations
├── docs/
│   ├── architecture.md   System architecture and data flow diagram
│   ├── gameplay-spec.md  Scoring, judgements, difficulty presets
│   ├── integration-spec.md Spotify OAuth, Supabase schema, distribution
│   └── ai-agent-guide.md How AI agents should navigate and edit this repo
├── scripts/setup/        Bootstrap helpers
├── pnpm-workspace.yaml
├── package.json          Root scripts: lint, test, build
└── tsconfig.base.json    Shared TypeScript config
```

---

## How to demo it (fast path)

> **No Spotify credentials required for a UI demo.**
> The overlay UI ships with a `MockSpotifyPoller` that simulates playback.

### Prerequisites
- **Node.js ≥ 20** (`node --version`)
- **pnpm ≥ 9** – install with `npm i -g pnpm`

### Steps

```bash
# 1. Clone
git clone https://github.com/Qrytics/spotifyHero.git
cd spotifyHero

# 2. Install all workspace dependencies
pnpm install

# 3. Build packages (shared-types must go first)
pnpm --filter @spotifyhero/shared-types build
pnpm --filter @spotifyhero/gameplay-core build
pnpm --filter @spotifyhero/chart-generator build
pnpm --filter @spotifyhero/audio-engine build
pnpm --filter @spotifyhero/leaderboard-client build

# 4. Start the overlay UI in a browser (demo mode, no Tauri needed)
pnpm --filter overlay-ui dev
```

Open **http://localhost:1420** in your browser.

You will see the idle screen. Because the mock poller starts in "not playing" state, open your browser console and run:

```js
// Simulate Spotify starting playback with a test track
window.__mockPoller?.simulatePlay({
  trackId: "demo-track-1",
  positionMs: 0,
  track: {
    id: "demo-track-1",
    name: "Demo Song",
    artists: ["Artist"],
    durationMs: 240000,
    bpm: 128,
  },
});
```

A synthetic chart will be generated and the note highway will start scrolling.

Press **Space** to toggle between autoplay and manual (keyboard) mode.
In manual mode, press **D F J K** to hit notes in lanes 0–3.

---

## Full development setup

### Additional prerequisites (for native Tauri window)
- **Rust ≥ 1.80** – install via [rustup](https://rustup.rs)
- **Tauri CLI v2** – `cargo install tauri-cli --version "^2"`
- **System webkit** (Linux: `libwebkit2gtk-4.1`, Windows: WebView2, macOS: built-in)

### Spotify developer credentials
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create an app, set redirect URI to `http://localhost:8888/callback`.
3. Copy the **Client ID**.
4. Create `apps/desktop/src-tauri/.env` (gitignored):
   ```
   SPOTIFY_CLIENT_ID=your_client_id_here
   ```

### Supabase (optional – for leaderboards)
1. Create a free [Supabase](https://supabase.com) project.
2. Run the SQL from `docs/integration-spec.md` to create the `leaderboard_entries` table.
3. Add your project URL and anon key to the app settings (see [Configuration](#configuration)).

---

## Running the app

### UI only (browser, no native window)
```bash
pnpm --filter overlay-ui dev
# → http://localhost:1420
```

### Full native app (Tauri window, always-on-top)
```bash
pnpm dev:desktop
# This starts vite on :1420 and opens the native Tauri overlay window
```

The window opens at 360×640 and stays above all other windows. You can:
- **Drag** it anywhere on screen.
- **Minimize** it to the taskbar.
- **Resize** it (minimum 200×400).
- Window position and size are saved automatically between sessions.

### Run tests
```bash
pnpm test
# Runs vitest across all packages
```

### Lint / type-check
```bash
pnpm lint
# Runs tsc --noEmit across all TypeScript packages
```

---

## Building for distribution

### Itch.io build
```bash
# Build the overlay UI first
pnpm --filter overlay-ui build

# Then build the Tauri native app (produces platform installer)
pnpm --filter desktop build
# or: cd apps/desktop && npx tauri build
```

Installers appear in `apps/desktop/src-tauri/target/release/bundle/`:
- macOS: `.dmg` / `.app`
- Windows: `.msi` / `.exe` (NSIS)
- Linux: `.deb` / `.AppImage`

Upload the appropriate file to your [Itch.io](https://itch.io) project page.

### Steam (future)
Planned via `steamworks-rs` crate. Achievements and cloud save hooks are stubs in `commands.rs`.

---

## How note generation works

spotifyHero uses a **hybrid pipeline** — deterministic first, ML-assisted second:

```
Spotify audio / Web API
        │
        ▼
  Beat & onset detection
  (Rust backend, cpal audio capture)
        │
        ▼
┌──────────────────────────────────┐
│  Stage 1: Deterministic chart    │
│  • Filter onsets by difficulty   │
│    density (Easy 30%, Expert 100%)│
│  • Assign lanes round-robin      │
│  • Enforce min lane gap (80 ms)  │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Stage 2: ML refinement (ONNX)   │
│  • Lightweight sequence model    │
│  • Improves phrasing & variety   │
│  • Confidence gate: if model     │
│    confidence < 0.65 → use       │
│    deterministic chart instead   │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Stage 3: Drift correction       │
│  • Spotify position reports lag  │
│  • DriftCorrector adjusts timing │
│    using wall-clock comparison   │
└──────────────────────────────────┘
```

**Why this approach:**
- Works fully **offline** — no server inference required.
- Deterministic fallback means charts are **never broken**.
- ML layer improves quality without hard dependency.

---

## Gameplay rules

### Lanes and keys
| Lane | Default key | Colour |
|------|-------------|--------|
| 0    | D           | Purple |
| 1    | F           | Green  |
| 2    | J           | Orange |
| 3    | K           | Blue   |

### Hit windows (default)
| Judgement | Timing window (±ms) |
|-----------|---------------------|
| Perfect   | 22 ms               |
| Great     | 45 ms               |
| Good      | 90 ms               |
| Bad       | 135 ms              |
| Miss      | > 135 ms            |

### Scoring
```
points = BASE_POINTS[judgement] × COMBO_MULTIPLIER
```
| Judgement | Base | Multiplier at combo 10+ | Multiplier at combo 50+ | Multiplier at 100+ |
|-----------|------|------------------------|------------------------|-------------------|
| Perfect   | 1000 | ×2                     | ×4                     | ×8                |
| Great     | 750  |                        |                        |                   |
| Good      | 400  |                        |                        |                   |
| Bad       | 100  | (resets combo)         |                        |                   |
| Miss      | 0    | (resets combo)         |                        |                   |

### Accuracy
`accuracy = (perfects × 1.0 + greats × 0.75) / totalNotes`

### Autoplay ↔ Manual toggle
Press **Space** (configurable) at any time during a song to switch modes.
Switching mid-song does **not** reset your score or combo.

---

## Configuration

Settings are stored in `~/.local/share/spotifyHero/settings.json` (Linux) or equivalent OS path via `tauri-plugin-store`.

| Setting | Default | Description |
|---------|---------|-------------|
| `difficulty` | `medium` | easy / medium / hard / expert |
| `autoplay` | `true` | Start in autoplay mode |
| `playKeybind` | `Space` | Toggle autoplay/manual |
| `laneKeys` | `["d","f","j","k"]` | Keys for lanes 0–3 |
| `playerName` | _(none)_ | Display name on leaderboard |
| `window.alwaysOnTop` | `true` | Keep window above all others |
| `window.opacity` | `0.95` | Window transparency (0.1–1.0) |
| `window.width` | `360` | Initial window width (px) |
| `window.height` | `640` | Initial window height (px) |
| `supabaseUrl` | _(none)_ | Your Supabase project URL |
| `supabaseAnonKey` | _(none)_ | Your Supabase anon key |
| `spotify_client_id` | _(none)_ | Spotify Developer app client ID |

---

## Leaderboards and sharing

### Leaderboards
When `supabaseUrl` and `supabaseAnonKey` are configured, scores are automatically submitted after each song. View the global leaderboard filtered by track and difficulty.

Without Supabase config, scores are stored locally only (`OfflineLeaderboardClient`).

### Challenging friends
After a song, tap **Share Challenge**. spotifyHero copies a link like:

```
https://your-supabase-url/challenge?track=TRACK_ID&diff=medium&score=48200&session=UUID
```

Your friend opens the link, sees your score, and loads the same song in spotifyHero to beat it.

---

## Contributing

1. Fork and clone the repo.
2. Run `pnpm install`.
3. Read `docs/ai-agent-guide.md` for safe edit zones and validation steps.
4. Make changes, run `pnpm lint && pnpm test`.
5. Open a pull request.

AI coding agents: see `docs/ai-agent-guide.md` for the full navigation and editing guide.

---

## Project roadmap

| Phase | Status | Goal |
|-------|--------|------|
| 1 – Foundation | ✅ Done | Monorepo, Tauri shell, overlay window, input handling |
| 2 – Gameplay MVP | ✅ Done | Highway renderer, autoplay/manual toggle, scoring + combo |
| 3 – Chart generation v1 | ✅ Done | Deterministic beat/onset charting + difficulty presets |
| 4 – Social loop | 🔲 Next | Leaderboards, challenge links, song+score sharing |
| 5 – Chart generation v2 | 🔲 Planned | ML refinement + confidence fallback (ONNX model) |
| 6 – Distribution | 🔲 Planned | Itch.io packaging, then Steam build pipeline |
| 7 – Steam features | 🔲 Future | Achievements, cloud save, Steam leaderboards |
