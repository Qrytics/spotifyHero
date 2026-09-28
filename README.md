# spotifyHero 🎵🎮

[![📄 Investor Pitch](https://img.shields.io/badge/📄-Investor%20Pitch-1ed760?style=flat-square)](./PITCH.md)

A desktop overlay game that turns your music into a **Friday Night Funkin' / Guitar Hero-style note highway** displayed in a tiny always-on-top window alongside your screen.

Two music sources: your own **music server** (Navidrome/Subsonic — the game streams and plays the audio itself, and charts from real onset analysis) or **Spotify** (the game follows along with what Spotify is playing). See [Music sources](#music-sources).

Watch notes autoplay, or switch to manual and play the lanes yourself. Climb leaderboards and challenge friends on any song.

Available on [Itch.io](https://spotifyhero.itch.io) (now). Steam build pipeline planned.

---

## Table of Contents
1. [▶ Play it on Windows](#-play-it-on-windows)
2. [What it does](#what-it-does)
3. [Tech stack](#tech-stack)
4. [Repository layout](#repository-layout)
5. [Music sources](#music-sources)
6. [Development](#development)
7. [Building for distribution](#building-for-distribution)
8. [How note generation works](#how-note-generation-works)
9. [Gameplay rules](#gameplay-rules)
10. [Configuration](#configuration)
11. [Leaderboards and sharing](#leaderboards-and-sharing)
12. [Contributing](#contributing)
13. [Project roadmap](#project-roadmap)

---

## ▶ Play it on Windows

Two ways in: download the installer, or build it from the repo. Everything you need
is in this section — you do not need to read anything below it to play.

### Option A — download the installer

1. Grab the latest **`spotifyHero_<version>_x64-setup.exe`** from
   [**Releases**](https://github.com/Qrytics/spotifyHero/releases/latest).
2. Run it. The installer is **not code-signed**, so Windows SmartScreen says
   *"Windows protected your PC"* → click **More info** → **Run anyway**.
3. It installs for the current user only, so there is no admin (UAC) prompt, and it
   installs the **WebView2** runtime for you if your Windows does not already have it
   (Windows 11 and current Windows 10 always do).

Then jump to [Connect your music](#connect-your-music--spotify-recommended).

### Option B — build it from the repo

Prerequisites — install all four first:

| What | Version | Where |
|---|---|---|
| **Node.js** | ≥ 20 | [nodejs.org](https://nodejs.org/en/download) (check with `node --version`) |
| **pnpm** | ≥ 9 | `npm i -g pnpm` |
| **Rust** | stable | [rustup.rs](https://rustup.rs) |
| **Visual Studio Build Tools** | 2022 | [Downloads](https://visualstudio.microsoft.com/downloads/) → *Tools for Visual Studio* → **Build Tools for Visual Studio**, and in the installer tick the **"Desktop development with C++"** workload |

> **The C++ workload is the one people miss.** Without it Rust has no linker and the
> build stops at `link.exe not found`. You do **not** need anything for WebView2 to
> build: the runtime ships with Windows, and the SDK is vendored by the `webview2-com`
> crate.

Then, in a fresh **PowerShell** or **Command Prompt**:

```bat
:: unzip the repo, or:
git clone https://github.com/Qrytics/spotifyHero.git
cd spotifyHero

pnpm run setup
pnpm play
```

`pnpm run setup` checks your toolchain, installs dependencies and builds the eight
workspace packages; `pnpm play` compiles the Rust shell and opens the overlay window.
Use `pnpm run setup`, **with `run`** — plain `pnpm setup` is pnpm's own built-in
command and does something else entirely. The first `pnpm play` spends a few minutes
compiling Rust; after that it starts in seconds.

### Connect your music → Spotify (recommended)

spotifyHero follows along with whatever Spotify is playing. Give it a Spotify app of
your own — that takes a minute and is free:

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and
   click **Create app** (any name and description will do).
2. Set the Redirect URI to exactly **`http://127.0.0.1:8888/callback`** — Spotify
   requires an exact match.
3. Copy the app's **Client ID** (32 hex characters).
4. In spotifyHero: **Settings → Spotify Client ID** → paste → **Save**.
5. Press **Connect**, approve in the browser window that opens, then press play in
   Spotify. If you were already connected, **Disconnect and Connect again** so the new
   Client ID is used.

**Why your own Client ID:** the one built into the app belongs to a Spotify app in
**development mode**, which only lets a handful of allowlisted accounts through —
everyone else gets a `403` (the app tells you so, and links to the dashboard).

Spotify **Premium is recommended but not required**; on a free account the timing is
rougher because playback control is limited. The scopes requested are
`user-read-playback-state`, `user-read-currently-playing`,
`user-modify-playback-state`, `user-read-email` (leaderboard name) and
`user-follow-read` (friends leaderboard).

### Or: My Library (a Navidrome music server)

If you run [Navidrome](https://www.navidrome.org) (or anything Subsonic-compatible),
pick **My Library** instead: the game streams and plays the audio itself, so the
playhead is exact and charts come from real onset analysis of the audio rather than a
BPM grid. It feels considerably better than Spotify mode — it just needs a server.
See [Music sources](#music-sources) for setup and the in-game browser.

> Create a **dedicated Navidrome user** for the game. Its credential lives in
> `localStorage`, not in the OS keychain.

### First run and controls

The window opens small (**180×420**) and stays above everything else, with a compact
custom title bar — drag the top strip to move it, and use the two buttons at its right
to minimize or close.

| Lane | Key | Colour |
|---|---|---|
| 0 | **D** | Purple |
| 1 | **F** | Green |
| 2 | **J** | Orange |
| 3 | **K** | Blue |

- Notes **autoplay** until you press a lane key; that switches you to manual play
  mid-song without resetting score or combo.
- **Space** does one thing per source: **pause/resume** in My Library (the game owns
  the audio), **toggle autoplay ↔ manual** under Spotify (where it does not).
- **Ctrl+Shift+D** opens diagnostics — chart analysis in My Library, Spotify polling
  in Spotify mode.
- **Calibrate before you judge the timing:** **Settings → Calibrate timing…** tap
  along to the beat, and it writes `playbackTimingOffsetMs` for the source you are on.
  Spotify mode needs far more offset than My Library, and audio latency differs
  between WebView2 (Windows) and WKWebView (macOS), so a default tuned on one will
  feel wrong on the other. Each source keeps its own offset.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *"Windows protected your PC"* | The installer is unsigned. **More info → Run anyway**. |
| The build stops with `linker 'link.exe' not found` | The **"Desktop development with C++"** workload is missing from Visual Studio Build Tools. Install it, open a new terminal, and re-run `pnpm play`. |
| Spotify **403** after connecting | The built-in Client ID is a development-mode app. Use your own Client ID (above), then Disconnect → Connect. |
| *Could not bind 127.0.0.1:8888* during login | Something else holds port 8888 (Jupyter and local proxies are the usual suspects), or you aborted a login and retried within a second or two — wait a few seconds and press Connect again. |
| Spotify login fails only on a work laptop | The app bundles Mozilla's root certificates (`rustls`) and ignores the Windows certificate store, so a corporate TLS-inspecting proxy is not trusted. Try off that network. |
| Nothing appears on the highway | No active Spotify device: press play in the Spotify client first. |
| Cannot resolve `@spotifyhero/*`, or stale behaviour after `git pull` | Workspace packages are consumed through a generated `dist/`. Re-run `pnpm run setup`. |
| Window will not resize with the mouse | Known-unverified on Windows: the window is undecorated, so the native resize borders may not be there. There is no in-app size control to fall back on yet — please open an issue if you hit this. |

**macOS and Linux:** the same Option B works (`pnpm run setup && pnpm play`); swap the
Visual Studio prerequisite for Xcode Command Line Tools on macOS, or
`libwebkit2gtk-4.1-dev` + `build-essential` on Linux. Prebuilt installers are Windows-only
for now.

---

## What it does

- You pick a music source on launch: **My Library** (your music server) or **Spotify**.
- From your library you pick a song and the game plays it. On Spotify you play any song and the game follows along.
- spotifyHero charts the track and displays a note highway in a **small floating window** (default **180×420** px on first launch in the Tauri app) that stays above all other windows.
- The game can run in **autoplay** (notes hit themselves) or **manual** play. `AppSettings` defaults to **manual** first (`autoplay: false`). In manual mode, use **D F J K** (defaults) when notes reach the hit line — a lane key is also what switches autoplay → manual, so no other key is needed for that. **Space** (configurable) **pauses and resumes** in My Library mode, where the game owns the audio; under Spotify, where it does not, it toggles autoplay ↔ manual instead.
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
│   ├── overlay-ui/       React + Canvas note highway and HUD
│   └── spotifyhero-web/  Isolated Next.js edition (YouTube URL → chart; shares no code)
├── packages/
│   ├── shared-types/     Zod schemas + TypeScript types (shared data contracts)
│   ├── game-state/       Zustand game store – phase, playback, scoring, settings
│   ├── note-highway/     Canvas 2D note highway renderer (swappable)
│   ├── gameplay-core/    Scoring engine, hit windows, combo, mode toggle
│   ├── audio-engine/     Poller interface, playback-clock + playback-source contracts
│   ├── onset-analysis/   Pure DSP: mono samples → onsets, tempo, pitch (music-server mode)
│   ├── chart-generator/  Hybrid note generation pipeline
│   └── leaderboard-client/ Supabase REST + offline fallback
├── docs/
│   ├── architecture.md   System architecture and data flow diagram
│   ├── gameplay-spec.md  Scoring, judgements, difficulty presets
│   ├── integration-spec.md Spotify OAuth, Supabase schema, distribution
│   ├── music-server-mode-plan.md      Music-server mode: the spec it was built to
│   ├── music-server-mode-progress.md  How far that got, and what is unverified
│   ├── highway-visual-overhaul-progress.md  Renderer overhaul log
│   ├── sustain-visual-troubleshooting.md    What has been tried on sustain rendering
│   ├── windows-playable-plan.md  Windows onboarding / packaging plan
│   └── ai-agent-guide.md How AI agents should navigate and edit this repo
├── supabase/migrations/  SQL to create leaderboard table + RLS (run in Dashboard)
├── .github/workflows/    CI: Windows build + release artifact
├── scripts/
│   ├── setup/            One-command setup (setup.js: install + build packages)
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
| Song selection | in-game browser (browse / search / recent / random) | whatever you start in Spotify |
| Needs | a Navidrome (or Subsonic-compatible) server | a Spotify account and the desktop client |
| Transport | play / pause / restart / volume in-game | Spotify's own controls |

**My Library setup.** Enter the server URL, username and password once. Authentication is
Subsonic's salted token (`md5(password + salt)`), so the password is never sent, and the
credential is kept under its own `spotifyHero_navidrome_v1` localStorage key — **not** in the
keychain yet, so treat it as you would a browser-saved password. The server address and username
come back in the form on every later visit (under `spotifyHero_navidrome_login_v1`), and so does
the password while **Remember password** is ticked — including after a login that failed, which is
when you actually need them. Ticking the box stores the plaintext, which is the same exposure as
the token already sitting beside it. Untick it, or sign out, to drop it.

**Finding something to play.** *Browse* drills artist → album → song; *Search* is `search3` over
the whole library; *Recent* is the songs you have actually played, newest first, one click to
replay (local to this machine — Subsonic has no recently-played-songs endpoint — and empty until
you have played something); *Random* deals ten playable songs, with album art and a Randomize
button for ten more.

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

## Development

Setup is the same one command players use — it installs dependencies and builds the
eight workspace packages, which every app consumes through a generated (gitignored)
`dist/`:

```bash
pnpm run setup       # → node scripts/setup/setup.js
pnpm run build:packages   # just rebuild packages/*, no install
```

### Browser demo (no accounts, no Rust)

```bash
pnpm dev:ui          # → http://localhost:1420
```

The overlay runs in a plain browser tab, with a `MockSpotifyPoller` standing in for
Spotify. Nothing is installed and no credentials are needed. Press **Space** to toggle
autoplay ↔ manual, **D F J K** to hit notes.

<details>
<summary>Starting fake playback from the console</summary>

The mock poller boots in a "not playing" state, so the idle screen is all you get until
you push a track at it. In the browser console — **two** underscores,
`window.__mockPoller`, not `_mockPoller`:

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

A synthetic chart is generated from `bpm` and the highway starts scrolling.

</details>

### Native app (Tauri window)

```bash
pnpm play            # alias of pnpm dev:desktop
```

Tauri's `beforeDevCommand` now runs `pnpm run build:packages` before starting Vite, so
this works on a checkout where nothing has been built yet. It needs Rust and a C
toolchain — see the [prerequisites table](#option-b--build-it-from-the-repo).

The window is built in `apps/desktop/src-tauri/src/lib.rs`: **180×420** on first launch
(min 180×280, max 640×1200), undecorated with the custom title bar in
`WindowChrome.tsx`, always-on-top by default, and page zoom hotkeys disabled. Only
**minimize** and **close** are rendered — the window is deliberately
`.maximizable(false)`. Only the window *position* is restored from `settings.json` on
later launches; size is saved there but never read back.

### Checks

```bash
pnpm test            # vitest across every package that has tests
pnpm type-check      # tsc --noEmit everywhere — the reliable whole-repo check
pnpm lint            # type-check for packages, next lint for spotifyhero-web

cd apps/desktop/src-tauri && cargo check    # Rust, not covered by any pnpm script
```

A single test file or name:

```bash
pnpm --filter @spotifyhero/gameplay-core exec vitest run src/__tests__/scoring.test.ts
pnpm --filter @spotifyhero/chart-generator exec vitest run -t "sustain"
```

### Spotify (development)

The **Client ID** is built into the desktop app
(`apps/desktop/src-tauri/src/spotify/config.rs`) as a public PKCE identifier, so a clone
runs without any credential of your own. Resolution order is per-user
`settings.json` → `SPOTIFY_CLIENT_ID` env → built-in default; changing it clears stored
tokens.

That built-in app is in Spotify **development mode** (a handful of allowlisted accounts;
add testers under **User Management**). **Extended quota** needs Spotify's partner
process and is not something the code can toggle — which is why players are pointed at
the in-app **Settings → Spotify Client ID** field instead.

`apps/desktop/src-tauri/.env` (gitignored, see `.env.example`) also works, but **only in
a development build**: it is loaded from the path baked in at compile time, so it has no
effect in a shipped binary.

### Supabase (optional – for leaderboards)
1. Create a free [Supabase](https://supabase.com) project.
2. Open **SQL Editor**, paste the contents of `supabase/migrations/20260418120000_leaderboard_entries.sql`, and **Run** (creates `leaderboard_entries`, RLS, and grants). Details also appear in `docs/integration-spec.md`.
3. Add your project URL and anon key to the app settings (see [Configuration](#configuration)), or set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at build time.

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
- macOS: `.app` in `bundle/macos/`, `.dmg` in `bundle/dmg/`
- Linux: `.deb` / `.AppImage`

`bundle.targets` is an explicit list (`nsis`, `app`, `dmg`, `deb`, `appimage`) rather
than `"all"`, and Tauri builds only the ones the host OS supports. On Windows that means
**NSIS only**: `"all"` would also build an MSI through WiX v3, which requires .NET
Framework 3.5 to be enabled — a first-build failure for a new contributor, for an
artifact nothing ships. The Windows bundle installs per-user (no UAC) and embeds the
WebView2 bootstrapper; if players ever report install failures on machines without
internet, `webviewInstallMode` can be escalated to `offlineInstaller` at the cost of
~127 MB in the installer.

Neither the Windows installer nor the macOS app is code-signed, so players see
SmartScreen / Gatekeeper warnings (`pnpm itch:push` prints the macOS instructions).

### CI

`.github/workflows/windows.yml` runs on `windows-latest` for every push to `main`, every
PR, and every `v*` tag. It runs exactly the two commands the player instructions give —
`pnpm run setup` then `pnpm run build:desktop` — so a green run is evidence the
documented path still works, uploads the NSIS installer as a build artifact, and on a
`v*` tag attaches it to the GitHub release.

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

### Hit windows

`DEFAULT_HIT_WINDOWS` (`packages/gameplay-core/src/index.ts`) applies on easy / medium /
hard; expert swaps in `EXPERT_HIT_WINDOWS` (`apps/overlay-ui/src/hooks/useGameLoop.ts`).
Both are padded for Spotify's poll jitter, and are the same for both music sources so
that leaderboard scores stay comparable.

| Judgement | Default (±ms) | Expert (±ms) |
|-----------|---------------|--------------|
| Perfect   | 40            | 88           |
| Great     | 60            | 108          |
| Good      | 80            | 138          |
| Bad       | 110           | 188          |
| Miss      | > 110         | > 188        |

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
Hitting any lane key switches autoplay → manual at any time during a song, and
switching mid-song does **not** reset your score or combo. Under **Spotify**,
**Space** (configurable) toggles the two modes in either direction.

### Pause (My Library only)
**Space** pauses and resumes the music — the same thing the ❙❙ button in the
bottom bar does, count-in included, so pausing during the 3·2·1 counts you in
again on resume. Spotify mode has no pause key: its transport belongs to the
Spotify client, so Space keeps the mode toggle there.

---

## Configuration

Two stores, deliberately:

- The full `AppSettings` (the Zod schema in `packages/shared-types`) lives in
  **`localStorage`** under `spotifyHero_settings_v1`, written by the game store.
- A small subset the Rust side needs — always-on-top, scroll speed, both timing offsets,
  Spotify Client ID — plus window geometry and OAuth tokens is mirrored into Tauri's
  `settings.json` via `tauri-plugin-store`, in the app data directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\io.spotifyhero.app\settings.json` |
| macOS | `~/Library/Application Support/io.spotifyhero.app/settings.json` |
| Linux | `~/.local/share/io.spotifyhero.app/settings.json` |

That file is **plaintext JSON, including the Spotify refresh token** — there is no
keychain integration yet (`TODO(keychain)`).

| Setting | Default | Description |
|---------|---------|-------------|
| `musicSource` | `null` | `null` = ask on launch, then `"server"` (My Library) or `"spotify"` |
| `difficulty` | `medium` | easy / medium / hard / expert |
| `autoplay` | `false` | Start in autoplay vs manual (`AppSettings` default) |
| `playKeybind` | `Space` | Pause/resume in My Library mode; toggle autoplay/manual under Spotify |
| `laneKeys` | `["d","f","j","k"]` | Keys for lanes 0–3 |
| `playbackTimingOffsetMs` / `serverPlaybackTimingOffsetMs` | `0` | Hit-timing offset, one per music source (Spotify needs far more of it). The in-game calibrator writes whichever is active. |
| `playerName` | _(none)_ | Display name on leaderboard |
| `window.alwaysOnTop` | `true` | Keep window above all others |
| `window.opacity` | `0.95` | Window transparency (0.1–1.0) |
| `window.width` | `360` | Zod schema default only — it does **not** reach the native window, which `lib.rs` always opens at **180** wide. Resize is saved to Tauri's store (`window_width`) but not read back on launch; only the window *position* is restored. |
| `window.height` | `640` | Same: schema default, native first launch (and every launch) is **420** tall. |
| `supabaseUrl` | _(none)_ | Your Supabase project URL. Can also be supplied at build time as `VITE_SUPABASE_URL` |
| `supabaseAnonKey` | _(none)_ | Your Supabase anon key. Build-time equivalent: `VITE_SUPABASE_ANON_KEY` |
| `spotifyClientId` | _(none)_ | Spotify Developer app Client ID, as set in **Settings**. This is the Zod / `localStorage` key; the same value is mirrored to Tauri's store under the snake_case key `spotify_client_id`, which is the one Rust reads |

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
| `scripts/setup/setup.js` | `pnpm run setup` | Check the toolchain, install dependencies, build `packages/*`. `--build-only` (`pnpm run build:packages`) skips the install; Tauri's build hooks call it |
| `scripts/build/generate-tauri-app-icon.ps1` | `pwsh scripts/build/generate-tauri-app-icon.ps1` | Generate all Tauri app icon sizes from source PNG |
| `scripts/release/itch-push.js` | `pnpm itch:push` | Upload Windows installer to itch.io via butler |

---

## Contributing

1. Fork and clone the repo.
2. Run `pnpm run setup`.
3. Read `docs/ai-agent-guide.md` for safe edit zones and validation steps.
4. Make changes, run `pnpm type-check && pnpm test`.
5. Open a pull request — CI builds it on Windows.

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
