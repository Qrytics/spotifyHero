# spotifyHero 🎵🎮

[![📄 Investor Pitch](https://img.shields.io/badge/📄-Investor%20Pitch-1ed760?style=flat-square)](./PITCH.md)

A desktop overlay game that turns your music into a **Friday Night Funkin' / Guitar Hero-style note highway** displayed in a tiny always-on-top window alongside your screen.

Two music sources: your own **music server** (Navidrome/Subsonic — the game streams and plays the audio itself, and charts from real onset analysis) or **Spotify** (the game follows along with what Spotify is playing). See [Music sources](#music-sources).

Watch notes autoplay, or switch to manual and play the lanes yourself. Climb leaderboards and challenge friends on any song.

Available on [Itch.io](https://spotifyhero.itch.io) (now). Steam build pipeline planned.

---

## Table of Contents
1. [What it does](#what-it-does)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [Music sources](#music-sources)
5. [How to demo it (fast path)](#how-to-demo-it-fast-path)
6. [Full development setup](#full-development-setup)
7. [Running the app](#running-the-app)
8. [Building for distribution](#building-for-distribution)
9. [How note generation works](#how-note-generation-works)
10. [Gameplay rules](#gameplay-rules)
11. [Configuration](#configuration)
12. [Leaderboards and sharing](#leaderboards-and-sharing)
13. [Contributing](#contributing)
14. [Project roadmap](#project-roadmap)

---

## What it does

- You pick a music source on launch: **My Library** (your music server) or **Spotify**.
- From your library you pick a song and the game plays it. On Spotify you play any song and the game follows along.
- spotifyHero charts the track and displays a note highway in a **small floating window** (default **180×420** px on first launch in the Tauri app) that stays above all other windows.
- The game can run in **autoplay** (notes hit themselves) or **manual** play. `AppSettings` defaults to **manual** first (`autoplay: false`). Press **Space** (configurable) during a song to **toggle autoplay ↔ manual**; in manual mode, use **D F J K** (defaults) when notes reach the hit line.
- Your score, combo, and accuracy are tracked. When the song ends, results are shown and your score is submitted to the leaderboard.
- One click generates a **challenge link** you can send to friends: they load the same song and try to beat your score.

---

## Tech stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop shell | **Tauri 2 + Rust** | Small binaries, strong security, native always-on-top window controls |
| Game / UI | **React + HTML5 Canvas** | 2D canvas highway (`NoteHighway`); React for HUD + menus |
| State | **Zustand + Zod** | Minimal, typed, predictable game state |
| Music sources | **Navidrome/Subsonic** streaming + **Web Audio**, or **Spotify Web API** polling | Own the audio when we can (exact clock); follow along when we can't |
| Audio sync | `AudioContext.currentTime`, or client **`playbackClock`** | Sample-accurate in library mode; smooth extrapolation with drift re-anchoring on Spotify |
| Onset detection | **Hand-written DSP** (`onset-analysis`, in a worker) | FFT/flux/tempo with no dependency, off the render thread |
| Chart generation | Hybrid: deterministic + optional **ML refiner** (stub in TS; ONNX planned in Rust) | Works offline; deterministic fallback always available |
| Leaderboards | **Supabase** (Postgres + Auth) | Fast MVP; can migrate to custom API later |
| Package manager | **pnpm workspaces** | Fast installs, strict dependency isolation |

---

## Repository layout

```
spotifyHero/
├── apps/
│   ├── desktop/          Tauri 2 Rust shell – native window, Spotify OAuth, IPC
│   └── overlay-ui/       React + Canvas note highway and HUD
├── packages/
│   ├── shared-types/     Zod schemas + TypeScript types (shared data contracts)
│   ├── game-state/       Zustand game store – phase, playback, scoring, settings
│   ├── note-highway/     Canvas 2D note highway renderer (swappable)
│   ├── gameplay-core/    Scoring engine, hit windows, combo, mode toggle
│   ├── audio-engine/     Poller interface, playback-clock + playback-source contracts
│   ├── onset-analysis/   Pure DSP: mono samples → onsets, tempo, pitch (music-server mode)
│   ├── chart-generator/  Hybrid note generation pipeline
│   └── leaderboard-client/ Supabase REST + offline fallback
├── services/
│   └── leaderboard/      (Future) optional edge functions / extras
├── docs/
│   ├── architecture.md   System architecture and data flow diagram
│   ├── gameplay-spec.md  Scoring, judgements, difficulty presets
│   ├── integration-spec.md Spotify OAuth, Supabase schema, distribution
│   ├── music-server-mode-plan.md  Music-server mode: the spec it was built to
│   └── ai-agent-guide.md How AI agents should navigate and edit this repo
├── supabase/migrations/  SQL to create leaderboard table + RLS (run in Dashboard)
├── scripts/
│   ├── build/            Build helpers (icon generation)
│   ├── release/          Release helpers (itch-push.js, itch.env.example)
│   └── README.md         Script reference
├── PITCH.md              Investor pitch with architecture diagrams
├── pnpm-workspace.yaml
├── package.json          Root scripts: lint, test, build
└── tsconfig.base.json    Shared TypeScript config
```

---

## Music sources

On first launch the overlay asks which music source to use; the choice is `musicSource` in
settings and can be changed any time from **Settings → Music source** (the **⏏** button in the
library footer also signs out of the server and returns to the picker). The two modes share the
scoring engine, the highway and the leaderboard, and nothing else.

| | **My Library** (music server) | **Spotify** |
|---|---|---|
| Who plays the audio | the game does (`AudioBufferSourceNode`) | Spotify does |
| Playhead | exact, from `AudioContext.currentTime` | reconstructed from polls, ±tens of ms |
| Chart from | real onset analysis of the decoded audio | a synthetic beat grid from the track's BPM |
| Song selection | in-game browser (browse / search / recent) | whatever you start in Spotify |
| Needs | a Navidrome (or Subsonic-compatible) server | a Spotify account and the desktop client |
| Transport | play / pause / restart / volume in-game | Spotify's own controls |

**My Library setup.** Enter the server URL, username and password once. Authentication is
Subsonic's salted token (`md5(password + salt)`), so the password is never sent, and the
credential is kept under its own `spotifyHero_navidrome_v1` localStorage key — **not** in the
keychain yet, so treat it as you would a browser-saved password.

Picking a song downloads it, decodes it, analyses it, and builds the chart — four stages with a
progress bar, typically a few seconds on a LAN. Analysis runs in a worker, and both the analysis
and the finished chart are cached (charts also in `localStorage`), so replaying a song or changing
difficulty skips most of that work. Tracks longer than 12 minutes are refused: the whole file is
decoded into memory. There is **no mid-song scrubbing** — the highway would need a full rebuild of
scoring state, so only restart-from-zero exists.

**Diagnostics.** In library mode, **Ctrl+Shift+D** opens a chart diagnostics panel: tempo and
phase, the onset-confidence distribution against the difficulty thresholds it is judged by, note
and sustain counts, and analysis/generation timings. It is the tool for tuning
`DIFFICULTY_PARAMS` against real audio (the presets were tuned against the synthetic Spotify
grid). Same shortcut in Spotify mode opens the Spotify poll panel instead. Copies as JSON, or read
`window.__spotifyHeroServerDiagnostics`.

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

# 3. Build workspace packages (shared-types first if you build individually)
pnpm --filter @spotifyhero/shared-types build
pnpm --filter @spotifyhero/gameplay-core build
pnpm --filter @spotifyhero/chart-generator build
pnpm --filter @spotifyhero/audio-engine build
pnpm --filter @spotifyhero/leaderboard-client build
# Or build everything: `pnpm build` from the repo root (runs each package's build script).

# 4. Start the overlay UI in a browser (demo mode, no Tauri needed)
pnpm --filter overlay-ui dev
```

Open **http://localhost:1420** in your browser.

You will see the idle screen. Because the mock poller starts in "not playing" state, open your browser console and run:

> Use **two** underscores: `window.__mockPoller` (not `_mockPoller`).

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

### Spotify (no `.env` required)
The **Spotify Client ID** for this project is built into the desktop app (`apps/desktop/src-tauri/src/spotify/config.rs`). It is a public identifier (PKCE); you do **not** need to create your own Spotify app to clone and play.

1. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), the **spotifyHero** app that uses this client ID must list redirect URI **`http://127.0.0.1:8888/callback`** (exact match). Spotify **development mode** only allows a small allowlisted set of users per app; for wider distribution you either add testers in **User Management** or (recommended for players) have each user create their own free Spotify app and enter its Client ID under **Settings** in the app (same redirect URI). **Extended quota** (unlimited users, no allowlist) requires Spotify’s partner process, not something the code can toggle.
2. **Optional:** Override the default Client ID with `apps/desktop/src-tauri/.env` (gitignored): `SPOTIFY_CLIENT_ID=...` (dev/build), or use the in-app **Settings** field (stored per machine).

### Supabase (optional – for leaderboards)
1. Create a free [Supabase](https://supabase.com) project.
2. Open **SQL Editor**, paste the contents of `supabase/migrations/20260418120000_leaderboard_entries.sql`, and **Run** (creates `leaderboard_entries`, RLS, and grants). Details also appear in `docs/integration-spec.md`.
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

The native window opens at **180×420** px by default (`apps/desktop/src-tauri/src/lib.rs`), stays above other windows, and uses a **custom title bar** (drag the top strip; compact window controls). You can:
- **Drag** it by the title strip (not on the minimize / maximize / close icons).
- **Minimize**, **maximize**, or **close** via the small buttons on the right.
- **Resize** it (minimum **180×280**).
- Horizontal window position may be restored from saved settings where implemented.

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

### Itch.io (build + upload)

**One-time:** install [butler](https://itch.io/docs/butler/installing.html), run `butler login`, and create a game on [itch.io](https://itch.io) (note the URL slug, e.g. `spotifyhero` in `https://yoursite.itch.io/spotifyhero`).

**Config:** copy `scripts/release/itch.env.example` to `scripts/release/itch.env` and set `ITCH_USER` and `ITCH_GAME` (or set those env vars in your shell).

**Ship a Windows build:**

```bash
pnpm itch:release
```

That runs `pnpm build:desktop` (overlay UI + Tauri NSIS installer) then `butler push` to the `windows` channel with the version from `apps/desktop/src-tauri/tauri.conf.json`. After upload, mark the file as the **Windows** executable in the itch editor if it asks.

**Manual build only** (upload later with `pnpm itch:push`):

```bash
pnpm build:desktop
```

Installers appear under `apps/desktop/src-tauri/target/release/bundle/`:
- Windows: `.exe` (NSIS) in `bundle/nsis/`
- macOS: `.dmg` / `.app`
- Linux: `.deb` / `.AppImage`

### Steam (future)
Planned via `steamworks-rs` crate. Achievements and cloud save hooks are stubs in `commands.rs`.

---

## How note generation works

spotifyHero uses a **hybrid pipeline** — deterministic first, optional ML second. What feeds it
depends on the music source:

- **My Library** — the decoded audio is analysed for real: STFT → spectral flux → adaptive peak
  picking → autocorrelation tempo and phase → per-onset pitch (`packages/onset-analysis`, run in a
  worker). Onsets are where the music actually hits, and `confidence` comes from flux salience.
- **Spotify** — there is no audio to analyse, so a quarter/eighth/sixteenth beat grid is
  synthesized from the track's BPM with a fixed phase bias. That synthetic grid, not the
  generator, is why Spotify charts can feel offset from the music.

```
Beat / onset stream (real onset analysis, or a synthetic BPM grid on Spotify)
        │
        ▼
┌──────────────────────────────────┐
│  Stage 1: Deterministic chart    │
│  • Filter by difficulty density  │
│    (e.g. Easy ~26%, Expert 100%) │
│  • Confidence-first when events  │
│    differ; even spread in time   │
│    when confidence is uniform    │
│  • Stable-hash lane assignment   │
│  • Min gap per lane (preset)     │
│  • Sustain assignment + ratio    │
│    validation; then merge        │
│    back-to-back same-lane holds  │
│    into one long sustain         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Stage 2: ML refinement (stub)   │
│  • `PassthroughMLRefiner` in TS  │
│  • Production: ONNX via Rust IPC │
│  • Confidence gate (< 0.65 →   │
│    keep deterministic chart)     │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Playback alignment              │
│  • Library: exact clock from     │
│    `AudioContext.currentTime`    │
│  • Spotify: extrapolating clock  │
│    vs polled position; re-sync   │
│    on large drift                │
└──────────────────────────────────┘
```

**Why this approach:**
- Works fully **offline** — no server inference required for the baseline chart.
- Deterministic fallback means charts are **never broken**.
- Optional ML layer (when wired and confident enough) can improve variety without blocking play.
- After sustain assignment, **`mergeContiguousSustainSeries`** collapses several short holds in a row on the same lane (where each tail meets the next head) into **one** long hold, matching how long presses should read on the highway.

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
| `musicSource` | `null` | `null` = ask on launch, then `"server"` (My Library) or `"spotify"` |
| `difficulty` | `medium` | easy / medium / hard / expert |
| `autoplay` | `false` | Start in autoplay vs manual (`AppSettings` default) |
| `playKeybind` | `Space` | Toggle autoplay/manual |
| `laneKeys` | `["d","f","j","k"]` | Keys for lanes 0–3 |
| `playbackTimingOffsetMs` / `serverPlaybackTimingOffsetMs` | `0` | Hit-timing offset, one per music source (Spotify needs far more of it). The in-game calibrator writes whichever is active. |
| `playerName` | _(none)_ | Display name on leaderboard |
| `window.alwaysOnTop` | `true` | Keep window above all others |
| `window.opacity` | `0.95` | Window transparency (0.1–1.0) |
| `window.width` | `360` | Default in Zod schema (`shared-types`). Tauri **first-launch** inner width is **180** in `lib.rs` until full geometry restore. |
| `window.height` | `640` | Schema default; Tauri **first-launch** inner height is **420**. |
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

## Scripts

Helper scripts live in `scripts/` with subdirectories by purpose. See [`scripts/README.md`](scripts/README.md) for full details.

| Script | Command | Purpose |
|--------|---------|---------|
| `scripts/build/generate-tauri-app-icon.ps1` | `pwsh scripts/build/generate-tauri-app-icon.ps1` | Generate all Tauri app icon sizes from source PNG |
| `scripts/release/itch-push.js` | `pnpm itch:push` | Upload Windows installer to itch.io via butler |

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
| 0 – Pitch / fundraising | 🔲 Active | Investor deck ([PITCH.md](./PITCH.md)), demo polish, seed round |
| 1 – Foundation | ✅ Done | Monorepo, Tauri shell, overlay window, input handling |
| 2 – Gameplay MVP | ✅ Done | Highway renderer, autoplay/manual toggle, scoring + combo |
| 3 – Chart generation v1 | ✅ Done | Deterministic beat/onset charting + difficulty presets |
| 4 – Social loop | 🔲 Next | Leaderboards, challenge links, song+score sharing |
| 5 – Chart generation v2 | 🔲 Planned | ONNX ML refinement in Rust + confidence fallback (TS stub exists) |
| 6 – Distribution | 🔲 Planned | Itch.io packaging, then Steam build pipeline |
| 7 – Steam features | 🔲 Future | Achievements, cloud save, Steam leaderboards |
