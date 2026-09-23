# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                 # pnpm workspaces; Node >= 20, pnpm >= 9

pnpm build                   # tsc build of every package (pnpm resolves topological order)
pnpm type-check              # tsc --noEmit everywhere — the reliable whole-repo check
pnpm lint                    # same as type-check for packages; runs `next lint` for spotifyhero-web
pnpm test                    # vitest run in every package that has tests

pnpm dev:ui                  # overlay UI in a browser at :1420 (mock Spotify, no Tauri)
pnpm dev:desktop             # Tauri native overlay window (starts vite on :1420 too)
pnpm dev:web                 # Next.js web edition at :3000/games/spotifyHero
pnpm build:desktop           # installers under apps/desktop/src-tauri/target/release/bundle/
pnpm itch:release            # build:desktop + butler push (needs scripts/release/itch.env)
```

**`pnpm build` before `pnpm dev:ui` on a fresh clone.** Workspace packages are consumed
through their `dist/` (`main`/`exports` point at `./dist/index.js`), so Vite cannot resolve
`@spotifyhero/*` until they are compiled. After editing a package, rebuild it (or the
consuming app sees stale code).

Single test / single file:

```bash
pnpm --filter @spotifyhero/gameplay-core exec vitest run src/__tests__/scoring.test.ts
pnpm --filter @spotifyhero/chart-generator exec vitest run -t "sustain"
```

Rust changes: `cd apps/desktop/src-tauri && cargo check` (not covered by any pnpm script).

## Three deployables, two codebases

- **Desktop** = `apps/desktop` (Tauri 2 / Rust shell) + `apps/overlay-ui` (React) + all of
  `packages/*`. This is the product the README describes.
- **`apps/spotifyhero-web`** is an **isolated** Next.js 14 App Router edition (YouTube URL →
  chart job, Vercel Postgres, own auth). It imports **nothing** from `@spotifyhero/*` and
  duplicates types/scoring/charting in `lib/`. Changing a shared package does not affect it,
  and it must not start importing them without a deliberate decision. Its tables
  (`sh_players`, `sh_song_charts`, `sh_chart_jobs`, `sh_scores`) are created lazily by
  `ensureSchema()` in `lib/db.ts`; the desktop leaderboard is a separate Supabase project
  (`supabase/migrations/`).

## Package layering

`shared-types` (Zod schemas, the only place data contracts live) → `gameplay-core` (pure
scoring/timing math) → `leaderboard-client` → `game-state` (Zustand store) → `note-highway`
(Canvas 2D renderer) → `overlay-ui`. `audio-engine`, `chart-generator` and `onset-analysis`
depend only on `shared-types`. Nothing below `overlay-ui` may touch `window`-specific APIs beyond the DOM,
`import.meta.env`, or Tauri.

### Dependency-inversion seams (important)

Two files in `overlay-ui` are thin re-export shims that also wire platform side effects at
module load. Edit the **package**, not the shim, for logic changes:

- `apps/overlay-ui/src/store/gameStore.ts` → re-exports `@spotifyhero/game-state` and calls
  `registerGameStoreSideEffects({ saveTauriAppSettings, setTauriAlwaysOnTop, playScoreEventSfx })`
  plus `patchGameStoreFromEnv` for `VITE_SUPABASE_*`. The store package works with zero
  side effects registered (tests, browser dev).
- `apps/overlay-ui/src/components/NoteHighway.tsx` → re-exports `@spotifyhero/note-highway`
  and calls `registerNoteHighwayPlaybackClock(calibratedPlaybackMs)`. Unregistered, the
  highway's clock returns `0`.

## Timing model — the core of this codebase

Spotify only reports position every few seconds, with tens of ms of jitter, so the playhead
is reconstructed client-side. Everything that judges or draws a note reads from this chain:

1. `useSpotifySync` (`apps/overlay-ui/src/hooks/useSpotifySync.ts`) polls a `SpotifyPoller`
   — `TauriSpotifyPoller` (IPC, 2800 ms) under Tauri, `MockSpotifyPoller` in the browser
   (exposed as `window.__mockPoller`; see README for the `simulatePlay` snippet). It filters
   polls: only track change, play/pause toggle, large seek, or a ~9 s heartbeat reach the store.
2. `playbackClock` (`lib/playbackClock.ts`) extrapolates from `performance.now()` and
   **ignores drift under 135 ms** so the highway never snaps on a poll.
3. `calibratedPlaybackMs()` (`lib/playbackPosition.ts`) = clock + user
   `settings.playbackTimingOffsetMs` (set by `OffsetCalibrator`). This is the scoring playhead.
4. `useGameLoop` (rAF) drives `ScoringEngine`/`NoteWindowManager` from that playhead;
   `NoteHighway` renders from the same value via its registered clock.

`useGameLoop` also owns a pile of hard-won recovery behaviour — stale-clock re-anchor on
chart mount, one-shot tail resync, replay detection on large backward jumps, sustain hold
grace windows for keyboard ghosting, AFK auto-switch to autoplay. Constants at the top of
the file document why each exists; changing them changes feel, so prefer adjusting a named
constant over restructuring the loop.

Note time → playback time always goes through `noteHeadTimeMs`/`noteTailTimeMs`/
`chartEndPlaybackMs` with `CHART_LEAD_IN_MS` (`gameplay-core/src/chartTiming.ts`, currently
`0`) — never compare `note.timeMs` to the playhead directly.

## Chart generation

`HybridChartGenerator` (`packages/chart-generator/src/index.ts`) is deterministic-first:
difficulty density filter from `DIFFICULTY_PARAMS`, stable-hash lane assignment, per-lane min
gap, sustain assignment, then `mergeContiguousSustainSeries` to collapse back-to-back
same-lane holds into one long hold. Stage 2 is `PassthroughMLRefiner` behind a confidence
gate; **the deterministic chart must always remain a valid fallback**.

On the **Spotify** path there is no onset analysis: `useChartGeneration` synthesizes a
quarter/eighth/sixteenth `BeatEvent` grid (`demoBeatEvents`) from Spotify's audio-features
BPM, with a 2000 ms phase bias. That synthetic grid, not the generator, is why charts can
feel offset from the audio.

On the **music-server** path (uncommitted, see below) `useServerChartGeneration` charts from
real onset analysis of the decoded audio — `packages/onset-analysis` (pure DSP, no DOM) run in
a worker via `apps/overlay-ui/src/lib/analysis/`. The two hooks are mutually exclusive: each
returns early on the other's `playback.source`.

## Tauri shell

`apps/desktop/src-tauri/src/lib.rs` builds the single `"overlay"` window: undecorated
(custom title bar is `WindowChrome.tsx`), 180×420 first launch, min 180×280, max 640×1200,
zoom hotkeys disabled. IPC surface is the `generate_handler!` list in `lib.rs`, implemented
in `commands.rs`. Spotify auth is PKCE with the public client ID baked into
`spotify/config.rs`; resolution order is per-user `settings.json` → `SPOTIFY_CLIENT_ID` env →
built-in default, and changing the client ID clears stored tokens.

Settings live in **two** places: the full `AppSettings` (Zod) in `localStorage`
(`spotifyHero_settings_v1`) written by `game-state`, and a small subset mirrored into Tauri's
`settings.json` store via `save_app_settings` (always-on-top, scroll speed, both offsets,
client ID) plus window geometry. Adding a persisted setting usually means touching
`AppSettingsSchema`, `AppSettingsPayload` in `commands.rs`, and `TauriAppSettingsPayload` in
`game-state`.

## Conventions

- All shared data shapes are Zod schemas in `packages/shared-types`; derive TS types with
  `z.infer`. Never redeclare a shared type elsewhere (the web app is the sole exception).
- `tsconfig.base.json` enables `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
  Hence the prevailing style: `arr[i]` is checked or `!`-asserted, and optional props are
  added conditionally (`...(x ? { key: x } : {})`) rather than set to `undefined`.
- Internal deps use `workspace:*`. Package-internal imports use explicit `.js` extensions
  (NodeNext resolution), including from `.tsx`.
- Manual lane input crosses from `useKeybinds` to `useGameLoop` as DOM custom events
  (`spotifyhero:lanehit` / `:lanedown` / `:laneup`), not React state.
- Per-frame code (highway render, game loop) avoids allocation, `map`/`filter`/`sort`, and
  React re-renders; batch score events through `onScoreEvents`.

## Active work

**`docs/music-server-mode-plan.md` is the approved plan for the next major feature**: two music
modes — a personal Navidrome music server (primary, the game streams and plays audio itself for
the first time) and Spotify (demoted to secondary). Unlike the rest of `docs/`, that file is
current and its facts were verified against the live server and this code. If you are asked to
work on music sources, mode selection, onset analysis, or the playback clock, read it first.

**`docs/music-server-mode-progress.md` says how far it got and where to resume.** All six phases
are written, compile, and pass unit tests — but the whole feature is still **uncommitted**, and
nothing has been exercised on real hardware (no Tauri build, no real server). That doc's
"Still needs verification against the real thing" list is the next work.

Because of that, two clocks now exist behind one seam: `activePlaybackClock()` returns either the
Spotify extrapolating clock or Navidrome's exact `AudioContext` clock, and `useGameLoop` branches
only on `exactClockRef` (never on the mode). `packages/onset-analysis` is an 8th package.

## Docs are partly stale — code wins

`docs/` and `README.md` are useful for intent but have drifted; verify before relying on them.
Known cases: `docs/architecture.md` and `docs/ai-agent-guide.md` say **PixiJS** (the renderer
is Canvas 2D in `packages/note-highway`), the hit windows in `README.md`/`docs/gameplay-spec.md`
do not match `DEFAULT_HIT_WINDOWS`/`EXPERT_HIT_WINDOWS` in code, and the Rust
`Settings::default()` says `autoplay: true` where `AppSettingsSchema` says `false` (harmless —
autoplay is not in the mirrored `TauriAppSettingsPayload`, so the Zod default is the only one
that reaches the UI). `docs/sustain-visual-troubleshooting.md` is a genuinely
useful log of what has already been tried on sustain rendering — read it before touching
sustain visuals.

High blast radius: `packages/game-state/src/index.ts`,
`apps/overlay-ui/src/hooks/useGameLoop.ts`, `packages/note-highway/src/NoteHighway.tsx`,
`apps/desktop/src-tauri/src/commands.rs`, `apps/desktop/src-tauri/tauri.conf.json`.
