# Music-server mode — implementation progress

Companion to `docs/music-server-mode-plan.md` (the spec; unchanged). This file tracks what is
built. Delete it when the feature lands.

## Status: all six phases written, compiled, and unit-tested

```bash
pnpm --filter "./packages/**" build
pnpm --filter "./packages/**" --filter "./apps/overlay-ui" type-check
pnpm --filter "./packages/**" --filter "./apps/overlay-ui" test     # green
```

The desktop shell builds too, as of 2026-09-24: `cargo check --all-targets` is clean and
`pnpm build:desktop` produces `spotifyHero.app` + `spotifyHero_0.0.1_aarch64.dmg` (ad-hoc
signed, no Developer ID). The app launches and stays up at ~110 MB RSS idle.

**Not** verified: anything that needs the real server, or eyes on the running UI — see
"Still needs verification against the real thing" at the bottom. No one has played a song in
Mode 1 on hardware yet; that is the next thing to do.

The first session to write this code had no Node toolchain at all, so `lib/navidrome/md5.ts` was
checked the hard way: transliterated to plain JS, run under `osascript -l JavaScript`, and every
digest matched `/sbin/md5` — all RFC 1321 vectors, block-boundary lengths 55/56/63/64/65, UTF-8,
and the Subsonic doc example
`md5("sesame" + "c19b2d") === "26719a1196d2a940705a59634eb18eab"`. It has a vitest suite now too.

## Done

### Phase 0 — clock extraction
- `packages/audio-engine/src/extrapolatingClock.ts` — `PlaybackClockImpl` moved verbatim out of
  overlay-ui, plus an injectable `NowFn` for testability and `readonly isExact = false as const`.
- `packages/audio-engine/src/__tests__/extrapolatingClock.test.ts` — first tests for this code:
  extrapolation, hold-while-paused, the `IGNORE_DRIFT_MS` branch, re-anchor on track
  change/pause/resume, `reset()`.
- `apps/overlay-ui/src/lib/playbackClock.ts` is now a 3-line re-export shim. All four consumers
  (`useGameLoop`, `useSpotifySync`, `OffsetCalibrator`, `playbackPosition`) unchanged.

### Phase 1 — Navidrome client
- `lib/navidrome/md5.ts` + `md5.test.ts` (see verification note above).
- `lib/navidrome/credentials.ts` — own localStorage key `spotifyHero_navidrome_v1`, own Zod
  schema, deliberately outside `AppSettingsSchema`. Carries the plan's honest SECURITY note and
  a `TODO(keychain)`.
- `lib/navidrome/client.ts` + `client.test.ts` — Subsonic 1.16.1 wrapper. Zod at the boundary,
  `NavidromeError.kind`, HTTP-200-with-`status:"failed"` handled, `content-type` guard before
  any decode, `format=raw`, `nd:` track-id prefix, 12-min cap, cover art, search3, playlists,
  paged album lists, `fetchTrackBytes` with progress, best-effort `scrobble`.

### Phase 2 — mode selection + library browser
- `shared-types`: `TrackSchema`/`Track` (with `SpotifyTrackSchema`/`SpotifyTrack` kept as
  deprecated aliases), `PlaybackState.source?: "spotify" | "server"` (**undefined means
  spotify**), `MusicSourceSchema`, and two settings: `musicSource` (nullable, default `null` =
  "ask") and `serverPlaybackTimingOffsetMs`. Neither is mirrored into Tauri's `settings.json`.
- `game-state`: `analysisStage` / `analysisProgress` + `setAnalysisProgress`, cleared in
  `resetRound()` and `setChart()`. No new `TrackLifecycleState`.
- **Three early-return guards keep the Spotify path byte-for-byte identical** —
  `useSpotifySync` and `useSpotifyProfileSync` return when `settings.musicSource === "server"`;
  `useChartGeneration` returns when `playback?.source === "server"` (so `demoBeatEvents` and its
  2000 ms bias are untouched).
- `hooks/useNavidromeAuth.ts` — session in local React state, not the store. Auth failure clears
  the credential; network failure keeps it so Retry works offline→online. A second localStorage
  record (`spotifyHero_navidrome_login_v1`) survives both, so the form reopens filled in — see
  "Added after Phase 6" below.
- `components/server/{SourcePicker,NavidromeLoginForm,ServerLibraryScreen}.tsx` — browse /
  search / recent / random, drill-down in local state, sized for the 180 px window.
- `App.tsx` `phase === "idle"` now branches: `null` → picker, `"spotify"` → `IdleScreen`,
  `"server"` → library. No new `GamePhase`.
- `SettingsPanel.tsx` — music-source segmented control; Spotify Client ID hidden in server mode;
  the hit-timing slider writes `serverPlaybackTimingOffsetMs` in server mode.
- `styles/global.css` — `--accent-library` + `.sh-lib-*` classes.

### Phase 3 — playback source abstraction + real audio

- `lib/audioContext.ts` — shared `AudioContext` singleton, `resumeAudioContext()`,
  `audioOutputLatencyMs()` (`outputLatency || baseLatency`, sanity-clamped).
- `lib/hitSound.ts` — `ensureAudioContext()` now delegates to that singleton and keeps its
  gain+compressor chain SFX-only.
- `packages/audio-engine/src/playbackSource.ts` — `PlaybackClock` discriminated on `isExact`,
  `PlaybackSource`, `PlaybackSourceCapabilities`, `PlaybackSourceEvent`. No `"seeked"` variant;
  `capabilities.seek: false` for both sources. Type-only, no DOM types, so audio-engine's
  `lib: ["ES2022"]` still compiles.
- `lib/playback/SpotifyPlaybackSource.ts` — façade. `start`/`stop`/`setVolume`/`seek`/`restart`
  are no-ops, `onEvent` never fires, and `useSpotifySync` still owns the poller and the
  `setPlayback()` calls. There is no `spotify_seek` IPC command, which is why restart is a no-op
  there and the backward-jump heuristic has to stay.
- `lib/playback/NavidromePlaybackSource.ts` — fetch (`format=raw`, re-fetch as `mp3` if
  `decodeAudioData` refuses) → one `AudioBuffer` → `AudioBufferSourceNode → GainNode →
  ctx.destination`. Exact clock; `outputLatency` sampled **once per anchor**, and `ctx` cached in
  a field, so the rAF path does no lookups. `nodeSeq` distinguishes "buffer ended" from "we
  called `stop()`" in `onended`. Scrobbles once per prepared track. `prepare()` resumes the
  context (the song click is the gesture), re-checks the 12-min cap against the **decoded**
  duration, and emits `isPlaying: false, positionMs: 0` without starting audio.
- `lib/playback/activeSource.ts` — one registry (`activePlaybackSource()`,
  `activePlaybackClock()`, lazily-created singletons) plus `playbackRestartSeq()` /
  `bumpPlaybackRestartSeq()`, the seam Phase 5's `restartSeqRef` reads.
  `activePlaybackClock()` falls back to the Spotify extrapolating clock, so it is never null and
  pre-refactor behaviour is preserved exactly.
- `hooks/useActivePlaybackSource.ts` — mounted **first** in `App.tsx`. Registers the source,
  pumps `state` → `setPlayback` / `restarted` → `bumpPlaybackRestartSeq`, calls `stop()` on the
  way out (releasing the ~92 MB buffer), and starts audio only when `phase` reaches
  `autoplay`/`manual`. Exposes `window.__serverSource` in DEV, same idea as `__mockPoller`.
- `lib/playbackPosition.ts` — rewritten to the plan's `calibratedPlaybackMs()`: per-source
  offset, clock from the registry. `packages/note-highway` unchanged.
- `OffsetCalibrator.tsx` — taps read `activePlaybackClock()`, and Apply writes
  `serverPlaybackTimingOffsetMs` in server mode (matching the Settings slider).
- `components/server/ServerTransportControls.tsx` inside `PlayBottomBar`, gated on
  `playback?.source === "server"`: play/pause, restart, 30 px volume slider, back-to-library
  (`stop()` then `resetRound()`). **No scrub bar.** The lane-key strip yields to it in server
  mode — the bar is `nowrap` in a window that can be 180 px wide.
- `App.tsx` — `onSelectSong` now calls `serverPlaybackSource().prepare(client, song, …)`, pushes
  stage/progress into the store, and shows a failure banner above the library. The
  `trackLifecycle` loading text renders `analysisStage` + percent.

**Resolved plan question §8.4:** `hitSound.ts` built its context with a bare
`new window.AudioContext()` (no options), so sharing is safe. Music connects to
`ctx.destination` **directly** — the SFX `DynamicsCompressorNode` (threshold −16) would duck the
song on every note hit.

#### Phase 3's dead end — closed by Phase 4, kept for the reason behind it

At Phase 3, selecting a song downloaded and decoded it and then **stopped at `phase: "loading"`**,
because nothing charted a server track. The plan's line "chart still
from the synthetic grid at this stage" does not hold: `demoBeatEvents` needs a BPM from Spotify
audio-features, and server tracks have none, so the Phase 2 guard in `useChartGeneration` is
correct to bail.

The console hatch that stood in for an acceptance test still works, and is still the quickest way
to isolate the transport from the chart pipeline:

```js
__serverSource.play(); __serverSource.pause(); __serverSource.restart();
__serverSource.setVolume(0.4);
```

It is enough on its own to answer plan §8.1 (`format=raw`), §8.2 (codec coverage), §8.3
(`outputLatency` non-zero) and §8.5 (RSS with a buffer resident).

### Phase 4 — onset analysis + real charts

This closes the Phase 3 dead end: selecting a server song now produces a chart from the actual
audio, and Mode 1 runs end to end.

- **`packages/onset-analysis` (new, 8th package).** Pure DSP, `lib: ["ES2022"]` so the compiler
  itself forbids reaching for `AudioBuffer` or a worker global. Depends only on `shared-types`;
  sits beside `chart-generator` in the layering, below it in nothing.
  - `fft.ts` — iterative radix-2 Cooley-Tukey, preallocated scratch, `Fft` instance reused
    across frames. `binToHz`/`hzToBin`.
  - `window.ts` — Hann window, `frameGeometry` (fftSize 2048 / hop 512 → 11.6 ms at 44.1 kHz),
    `frameTimeMs`/`frameAtTimeMs`. Frame time is the window **centre**, which is what makes
    onset times line up with what a listener hears.
  - `spectralFlux.ts` — one STFT sweep producing flux (log-compressed, half-wave rectified),
    plus per-frame `amplitude`/`rms`. One pass, because a second one would double the only
    expensive part of the pipeline.
  - `peakPicking.ts` — adaptive median + percentile threshold, local-max test, refractory gap,
    `parabolicShift` for sub-hop interpolation.
  - `tempo.ts` — autocorrelation of the mean-removed envelope over 60–200 BPM, scored through a
    comb filter and a log-normal prior centred on 120 BPM (which is what beats the half- and
    double-tempo peaks), then a quarter-frame phase search. Phase is not optional:
    `buildRhythmContext` takes `beatTimes[0]` as `gridStartMs`.
  - `pitch.ts` — `PitchEstimator`, one extra FFT per onset, candidates from observed spectral
    peaks scored by a `1/h`-weighted harmonic sum (the ordering that avoids the octave error).
    Feeds `BeatEvent.pitchHz`, so manual-hit audio synthesis works on server tracks.
  - `analyzeOnsets.ts` — the entry point, and where the three easy-to-get-wrong invariants are
    documented: `amplitude`/`rms` stay **absolute** (the generator's silence gate compares them
    to fixed thresholds), a **complete `isBeat` grid** is emitted (`buildRhythmContext` needs
    ≥ 4 and takes `beatTimes[0]` as `gridStartMs`), and there is **no phase bias** — the
    `demoBeatEvents` 2000 ms shift exists only because that grid has no idea where the music
    starts. Also derives `normalizationProfile` from the 90th-percentile frame RMS, which is
    structurally the generator's `SongNormalizationProfile`.
  - `ONSET_ANALYSIS_VERSION` — bump on any change that would chart the same audio differently,
    retuned constants included. The persisted chart cache keys on it.
  - Tests: `fft` (against a naive DFT), `window`, `spectralFlux`, `peakPicking`, `tempo`,
    `pitch`, `analyzeOnsets` (synthetic click trains from `__tests__/signals.ts`).
- **Worker seam in `apps/overlay-ui/src/lib/analysis/`.** Analysis is ~0.6–1.5 s of tight FFT
  for a 4-minute track — on the main thread that is 50–90 dropped frames in a window that is
  visible and showing progress.
  - `onsetWorkerProtocol.ts` — message types only, so the main thread talks to the worker with
    `import type` and the DSP never lands in the main chunk.
  - `onsetWorker.ts` — one call into `analyzeOnsets`. Declares the two members of
    `DedicatedWorkerGlobalScope` it uses rather than adding the `WebWorker` lib next to `DOM`.
  - `analyzeAudioBuffer.ts` — `downmixToMono` (averages, so samples stay in −1..1 for those
    absolute thresholds) then transfers the copy. The copy is unavoidable:
    `getChannelData()` is a live view of memory the `AudioBufferSourceNode` is playing from, so
    transferring *it* would detach the buffer making sound. Falls back to the main thread if a
    worker cannot be constructed; one worker per analysis, terminated in `finally`.
  - `preparedAudio.ts` — the hand-off registry. `prepare()` emits `playback` into the store
    **before** its promise resolves, so the analysis effect usually runs first;
    `waitForPreparedAudio` blocks on the buffer with an abort signal instead of polling. Reads
    are **non-destructive** — a difficulty change has to be able to pick the same buffer up
    again. `clearPreparedAudio()` is called wherever `stop()` is (mode change, back-to-library,
    failed prepare), because the source and this registry are two holders of the same ~92 MB.
- **`lib/chartCache.ts`** — three tiers, one per cost: analysis in memory (2 entries, so a
  difficulty change re-runs only `generate()`), charts in memory (8), charts in `localStorage`
  (10, `spotifyHero_chartCache_v1`). Analysis results are never persisted — `BeatEvent[]` for a
  4-minute track would blow the quota alone. Every stored chart is re-parsed with `ChartSchema`
  on read and dropped if it no longer validates; entries are invalidated on both
  `generatorVersion` and `ONSET_ANALYSIS_VERSION`, on read *and* on write. A quota rejection
  halves the set and retries rather than losing the newest chart.
- **`hooks/useServerChartGeneration.ts`** — same trigger as `useChartGeneration`
  (`phase === "loading"`), mirror-image guard, so exactly one of the two acts on any track.
  Pipeline with three entry points: cached chart → done; cached analysis → `generate()`;
  otherwise wait for the buffer → analyse → `generate()`. `settings.difficulty` is read at
  generate time and deliberately **not** an effect dependency, so toggling difficulty mid-analysis
  does not restart the analysis. Failure path is `resetRound()` (back to the library), not
  `setPhase("idle")`, which would offer a track with no chart.
- **`App.tsx`** — mounts the hook, and `prepare().then(...)` now calls
  `setPreparedAudio(track.id, buffer)`. That is the whole wiring; the stale "Phase 4 does not
  exist yet" comment is gone.
- Tests: `lib/chartCache.test.ts` (round trip, difficulty keying, both invalidation axes,
  corrupt entry, unreadable storage, quota retry — with a `FakeStorage`, since vitest runs this
  app in node where `localStorage` is absent) and `lib/analysis/preparedAudio.test.ts` (both
  orderings of the race, non-destructive reads, wrong-track announcement, abort).

**Not addressed here, on purpose:** `analysisProgress` reaches the store roughly every 256 STFT
frames (~80 updates for a 4-minute track). That is ~80 React re-renders in a second, which is
fine only because the highway is unmounted behind the "Analyzing…" screen. (Phase 6 narrowed those
re-renders to `TrackLoadingIndicator`.)

### Phase 5 — loop adaptation

Everything is behind `exactClockRef` (`useGameLoop.ts`), refreshed in the `[chart]` effect and in
the loop prologue. There is no `if (mode === "server")` anywhere in the loop, which is the point:
the loop knows only whether its clock can be trusted.

- `syncClockToStorePlayback` returns early on `clock.isExact` — one guard covering all four call
  sites. Re-anchoring an exact clock to a polled position could only make it worse.
- `EXACT_FINISH_STALE_WAIT_FRAMES = 2` next to `FINISH_STALE_WAIT_FRAMES = 180`, selected by the
  ref. This is the visible win: results used to appear ~3 s after the last note.
- The `CHART_MOUNT_STALE_MS` re-anchor and the early tail resync both gained `!exactClockRef.current`.
  Constants untouched — they exist for a *stale extrapolated* playhead, which an exact clock cannot
  have.
- Restart is now event-driven: `restartSeqRef` vs `playbackRestartSeq()` is checked **before** the
  backward-jump heuristic, which stays as the `else`. Spotify has no restart event and the
  heuristic is also the net for an event that never arrived.
- `resumeSpotifyPlayback()` → `void activePlaybackSource()?.play()`.
- `playbackVolumeGate` (**both** copies, app + `packages/note-highway`) returns `false` for
  `source === "server"`: that volume is our own slider, and playing quietly must not blank the
  highway. Still a pure function of `PlaybackState`, because the note-highway copy cannot reach the
  source registry. New test: `apps/overlay-ui/src/lib/playbackVolumeGate.test.ts`.
- `EXPERT_HIT_WINDOWS` left alone with a `TODO(hit-windows)`, per the plan: an exact clock could
  justify tightening them, but per-mode windows make leaderboard scores incomparable. Separate PR.

Forward seek was **not** implemented and `ScoringEngine.resolveSilentlyBefore()` was not added —
scrubbing is out of v1 by decision, so nothing would call it.

### Phase 6 — polish

- `components/TrackLoadingIndicator.tsx` — replaces the inline loading text in `App`: stage label,
  percent, a determinate/indeterminate bar (`.sh-lib-progress*` in `global.css`) and "step N of 4".
  It owns the `analysisStage`/`analysisProgress` subscriptions, which is also the fix for the
  re-render note left at the end of Phase 4 — ~80 progress updates now re-render this component
  instead of the whole app tree. The Spotify path still renders exactly the old single line.
- `lib/serverDiagnostics.ts` + `components/server/ServerDiagnosticsPanel.tsx` — the confidence
  tuning surface the plan asks for, on the **same** `Ctrl+Shift+D` toggle and the same
  `spotifyHero_debug` key as `SpotifyDiagnosticsPanel`; `App` renders whichever panel matches
  `settings.musicSource`, since both are fixed to the bottom of the window. It shows tempo/phase,
  `OnsetAnalysisStats`, the onset-confidence distribution as percentiles plus a sparkline
  histogram, and — the part that matters — how many onsets clear this difficulty's
  `onsetConfidenceFloor` and `sustainConfidenceMin`, with empty-chart and no-sustain outcomes
  called out in amber. Also note/sustain/lane/gap counts, analyse and generate timings, and
  whether the active clock is exact. Copy button, JSON toggle,
  `window.__spotifyHeroServerDiagnostics`.
  - Published from `useServerChartGeneration`, including on the chart-cache path (enriched with the
    in-memory analysis when it is still there). Wrapped in try/catch: diagnostics must never be why
    a chart fails to load.
  - `summarizeConfidence` / `summarizeChart` are pure and tested
    (`lib/serverDiagnostics.test.ts`), empty-chart case included.
- README — new **Music sources** section (mode comparison table, library setup, the 12-minute cap,
  no-scrubbing, the diagnostics shortcut), `musicSource` and the two timing offsets in the settings
  table, tech-stack rows for the server source and `onset-analysis`, and "How note generation
  works" now says where each mode's beat stream comes from instead of implying one pipeline.

## Remaining

Nothing in the plan's phases. `pnpm build`, `type-check` and `test` are green for
`./packages/**` + `./apps/overlay-ui`, and `apps/desktop` now builds as well (see above).

What is left is the real-hardware verification below, plus two deliberate deferrals:
- per-mode hit windows (`TODO(hit-windows)` in `useGameLoop.ts`);
- the Navidrome credential **and the remembered password** in the keychain rather than
  localStorage (`TODO(keychain)`).

**Added after Phase 6 — remembered login, real Recent, Random tab.** Three follow-ups from
playing it for real:
- `lib/navidrome/credentials.ts` grew a *login hint* (`spotifyHero_navidrome_login_v1`:
  `{serverUrl, username, password?, rememberPassword}`), deliberately a second record so it
  survives the `clearCredentials()` that an auth failure triggers — the old behaviour made a
  one-character password typo cost you the server address too. `serverUrl` is stored **as typed**,
  pre-`normalizeServerUrl`, because it goes back into the field. `rememberPassword` is tracked
  apart from `password` so sign-out can strip the password without silently unticking the box.
  `NavidromeLoginForm` seeds its fields from it and keeps its DOM-ref-authoritative submit
  (WKWebView autofill). The header SECURITY note now says plainly that the plaintext is stored
  when the box is ticked.
  **First version of this did not work, and why:** `useNavidromeAuth.login` wrote the hint only
  after `verify()` succeeded, and never updated the in-memory `savedLogin` the form seeds from.
  A failed attempt — which is the only kind you have before the login works — therefore
  remembered nothing, and a wrong *address* fails as a network error, which swapped the form for
  the Retry screen and so destroyed the component state holding the typed password too. The hint
  is now written (and `savedLogin` set) *before* `deriveCredentials`, so the box means "remember
  what I typed", and `verify(creds, restorable)` only shows the Retry screen for a credential
  that came out of storage; a fresh submission that cannot reach the server stays on the form
  with the message inline.
- `lib/navidrome/playHistory.ts` — 30-entry ring buffer keyed by `serverUrl`, storing a whole
  `NavidromeSong` (reusing `SongSchema`, so a stored row feeds `prepare()` with no refetch).
  Written from `App.tsx`'s `onSelectSong` once `prepare()` resolves — the same moment
  `NavidromePlaybackSource` scrobbles — inside a `try/catch`, because history must never be why a
  song fails to load. `RecentPane` renders it as one-click song rows. The old newest-albums list
  is **gone**, not kept as a fallback: "recent" means recently played by you, and recently *added
  to the server* is a different list wearing the same label. An empty history is one line of text,
  and `client.getAlbumList` now has no caller in the UI (still wrapped and tested).
- `client.getRandomSongs(size)` (`getRandomSongs` was the one obvious endpoint left unwrapped)
  behind a fourth `RandomPane`: over-fetch 15, drop anything past the 12-min cap, show 10,
  Randomize re-rolls by bumping a `seq` that is `useAsync`'s key (so a fast double-click can't
  paint a stale deal). `.sh-lib-tab` got `nowrap` + `min-width: 0` for the fourth tab.
- `SongRow` takes an optional `coverClient`, which swaps the track-number column for a 24 px
  `CoverThumb`. **Search, Recent and Random pass it**; Browse does not — inside one album the
  track number is the useful column and every thumb would be the same picture. Falls back to
  `song.albumId` when the `coverArt` tag is empty, since Navidrome resolves album ids through
  `getCoverArt` too; a wrong guess 404s into the existing `onError` placeholder. Reuses
  `AlbumRow`'s memoized URL cache, so no new fetch machinery and no extra work per keystroke in
  the search box.

**Added after Phase 6 — Space pauses in Mode 1.** `settings.playKeybind` (default `Space`) now
means *pause/resume* when `playback.source === "server"`, and still means autoplay ↔ manual under
Spotify, where the game cannot pause anything it owns. `useKeybinds` runs the same two calls
`ServerTransportControls` does — `src.pause()` and `playWithOptionalCountIn()` — behind a
module-level `transportBusy` flag (the keyboard's copy of the button's `busy`), and pulses nothing:
`ScreenPulse` already derives PAUSED from `phase`. **Mode 1 therefore has no key for
manual → autoplay**; a lane key covers the other direction, the AFK switch and
`settings.autoplay` cover this one, and the settings panel calls the field "Pause key" in that
mode. Branching on `playback.source` is deliberate here — the CLAUDE.md rule against branching on
the mode is about the *clock* in `useGameLoop`, and this is the same predicate
`ServerTransportControls` and `useChartGeneration` already use.

**Fixed after Phase 6:** the DSP was shipping in the main Vite chunk, contrary to what Phase 4
intended — `chartCache.ts` and `serverDiagnostics.ts` imported `ONSET_ANALYSIS_VERSION` from the
package index, and Rollup will not split a module that anything imports statically. The constant
now lives in `packages/onset-analysis/src/version.ts` behind a `./version` subpath export with no
DSP in its graph. The analyser is a lazy 10 kB chunk again (main chunk 380 → 371 kB), and the
`vite build` warning is gone. **Import the version from the subpath, never from the root.**

## Committed

All six phases landed on `main` as `d86fcf8` ("Music-server mode: play and chart your own
library"), followed by `81011b6` (the main-chunk fix described above).

## Still needs verification against the real thing (from plan §8)

1. `format=raw` actually honoured by Navidrome 0.63.2.
2. WKWebView `decodeAudioData` codec coverage on macOS for FLAC/Opus (fallback: `format=mp3`).
3. `outputLatency` non-zero on macOS **and** Windows.
4. Real Tauri RSS with a ~92 MB `AudioBuffer` held. Baseline measured 2026-09-24: the release
   app idles at ~110 MB RSS with nothing loaded, so watch for ~200 MB during a long track.
