# Plan: two music modes — personal music server (primary) + Spotify (secondary)

> **Status: APPROVED PLAN, NOT YET IMPLEMENTED (as of 2026-09-23).**
> No code in this repo has been changed for this feature yet. This document is the agreed
> implementation plan — start at Phase 0 in §7. Unlike the rest of `docs/`, this file is current
> and was written against the code as it exists today; the facts in the "Verified facts" table
> were probed, not assumed.

## Context

Today the game has no music system of its own. It **plays no audio at all**: `useSpotifySync`
polls Spotify over Rust IPC every 2800 ms, and the UI literally instructs the user to "press play
in Spotify" (`IdleScreen.tsx:163`). Everything downstream is built around that constraint —
`playbackClock` reconstructs a playhead by extrapolating from `performance.now()` and
deliberately discards position corrections under 135 ms, `useGameLoop` carries a pile of
stale-transport recovery hacks, and `demoBeatEvents` synthesizes the entire note grid from
Spotify's audio-features BPM with a hardcoded 2000 ms fudge (which CLAUDE.md names as the reason
charts feel offset).

The goal is to invert this: the game gains its **own** built-in music library, streamed from a
personal Navidrome server, with Spotify demoted to an alternative mode. Mode 1 is not a port of
Mode 2 — it is a structurally better path, because when the game owns the audio it gets an exact
playhead and real audio to analyze. Mode 2 must keep working exactly as it does now.

### Verified facts (probed, not assumed)

| Fact | Consequence |
| --- | --- |
| Server is **Navidrome 0.63.2**, Subsonic API **1.16.1**, `openSubsonic: true` | Use the Subsonic REST API directly |
| **Substreamer is a client app, not a server layer** | Irrelevant to this work; ignore it entirely |
| `/rest/ping`, `/rest/stream`, `/rest/getCoverArt` all return `access-control-allow-origin: *`; `OPTIONS` preflight passes | Renderer `fetch` + `decodeAudioData` works. **No Rust proxy needed.** |
| `getOpenSubsonicExtensions` lists `transcodeOffset, formPost, songLyrics, indexBasedQueue, transcoding, playbackReport` — **no `apiKeyAuthentication`** | Auth must be classic `u` + `s`(salt) + `t`(md5(password+salt)) |
| A failed `stream` request returns **HTTP 200 with `content-type: application/xml`** | Must check content-type before decoding, or you feed an error document to the audio decoder |
| Tauri `csp: null`, no restrictive capabilities | Webview may fetch/stream from the music origin unrestricted |
| `Child.duration` is in **seconds** (integer) | Convert to ms; treat as coarse — prefer the decoded buffer's exact duration |
| `Child.bpm` exists as an optional OpenSubsonic tag field | Use only as a cross-check hint; real tempo comes from analysis |
| No md5 in the repo and none in SubtleCrypto | Must hand-roll md5 (~60 lines) or add a Rust command |

Server web UI (for manual cross-checking): `https://music.mario-belmonte.com/app/#/login`

### Decisions locked with the user

1. Real onset analysis via Web Audio (not the synthetic grid) for Mode 1.
2. In-game login; persist `{serverUrl, username, salt, token}`, never the plaintext password.
3. Player + transport: play/pause, restart, volume, back-to-library. No queue.
   **No mid-song scrubbing in v1** — see "Why no scrubbing" in §4. (This narrows the original
   choice, which had included seek; the reasoning is recorded there.)
4. Desktop overlay only. `apps/spotifyhero-web` is untouched.

### Guiding principle

**New code goes in new files gated on `playback.source === "server"`, never as branches inside
working files.** `useGameLoop.ts` and the Spotify path get the smallest possible number of edits.

---

## 1. Architecture

```
ServerLibraryScreen ──► NavidromeClient (fetch, Subsonic REST)
                              │  getArtists / getArtist / getAlbum / search3 / getCoverArt
                              ▼
useActivePlaybackSource ──► NavidromePlaybackSource ──► AudioBuffer ──► GainNode ──► out
        │ registers                  │ exact clock              │
        ▼                            ▼                          └──► mono downmix
  activePlaybackSource()      calibratedPlaybackMs()                      │ transfer
        │                            │                                     ▼
        │                     useGameLoop / NoteHighway            onsetWorker
        │                                                           analyzeOnsets()
        └──► SpotifyPlaybackSource (façade over today's code)             │
                                                                   BeatEvent[] + bpm
                                                                          ▼
                                                            HybridChartGenerator ──► setChart
```

**Talk directly to Navidrome's Subsonic API from the renderer.** Substreamer is just another
client; there is nothing to route through. Precedent for renderer-side `fetch` already exists in
`packages/leaderboard-client` (hits Supabase PostgREST directly). Rust IPC is unnecessary here
because CORS is open, and it would not help anyway: the decode path needs the bytes in the
webview regardless.

**Authentication**: one random 16-byte salt generated at login; `token = md5(password + salt)`.
Subsonic permits reusing a fixed salt/token pair, so the plaintext password is used exactly once
(at login, to compute the token) and then discarded. Every request carries
`?u=<user>&t=<token>&s=<salt>&v=1.16.1&c=spotifyHero&f=json`.

**Metadata** comes from the Subsonic browse/search endpoints. **Audio** is fetched once as an
`ArrayBuffer` with `format=raw` and decoded to an `AudioBuffer`, which serves *both* playback and
onset analysis — so the chart is aligned to byte-identical samples to what the player hears, and
any codec delay cancels out by construction.

### New/changed packages

| Path | Status | Purpose |
| --- | --- | --- |
| `packages/onset-analysis/` | **new** | Pure DSP. `lib: ["ES2022"]` (no DOM) so node tests work and the compiler forbids touching `AudioBuffer` |
| `packages/audio-engine/src/playbackSource.ts` | **new file** | `PlaybackClock` / `PlaybackSource` interfaces |
| `packages/audio-engine/src/extrapolatingClock.ts` | **new file** | `PlaybackClockImpl` moved here from overlay-ui, + first-ever tests |
| `apps/overlay-ui/src/lib/navidrome/` | **new** | `client.ts`, `credentials.ts`, `md5.ts` |
| `apps/overlay-ui/src/lib/playback/` | **new** | `activeSource.ts`, `NavidromePlaybackSource.ts`, `SpotifyPlaybackSource.ts` |
| `apps/overlay-ui/src/lib/analysis/` | **new** | `onsetWorker.ts`, `analyzeTrack.ts` |
| `apps/overlay-ui/src/components/server/` | **new** | `SourcePicker`, `NavidromeLoginForm`, `ServerLibraryScreen`, `ServerTransportControls` |

Layering is respected: `onset-analysis` depends only on `shared-types`; nothing below
`overlay-ui` touches Web Audio.

---

## 2. Game startup / mode selection

Add to `AppSettingsSchema` (`packages/shared-types/src/index.ts`):

```ts
musicSource: z.enum(["spotify", "server"]).nullable().default(null),
serverPlaybackTimingOffsetMs: z.number().int().min(-500).max(500).default(0),
```

`null` = not yet chosen, which is what shows the picker. Existing installs lack the key, so they
see the picker once — that is how the feature gets discovered. A "Change music source" row goes
in `SettingsPanel` for switching later.

**Do not** mirror either field into Tauri's `settings.json` (`AppSettingsPayload` in
`commands.rs` / `TauriAppSettingsPayload`). Nothing native reads them; localStorage only.

**Do not add a new `GamePhase`.** `idle` already means "no song playing, waiting" — which is
exactly "browsing a library". Gate inside the existing flat-conditional JSX at `App.tsx:124`:

```tsx
{phase === "idle" && (
  settings.musicSource === null    ? <SourcePicker /> :
  settings.musicSource === "spotify" ? <IdleScreen onOpenSettings={...} /> :
                                       <ServerLibraryScreen onOpenSettings={...} />
)}
```

**Preserving the Spotify flow** comes down to three guards:

- `useSpotifySync.ts` — `if (musicSource === "server") return;` at the top of the effect, dep
  array `[]` → `[musicSource]`. Without this it calls `pauseSpotifyPlayback()` on track change
  and pushes a *different* `trackId` into `setPlayback`, which wipes the chart and loops
  `phase: "loading"` forever.
- `useSpotifyProfileSync.ts` — same guard.
- `useChartGeneration.ts` — one early return `if (playback?.source === "server") return;`.
  `demoBeatEvents` and its 2000 ms bias stay exactly as they are, for Spotify, where we have no
  audio to analyze.

`window.__mockPoller` browser dev is unaffected: picking "Spotify" yields today's behaviour.

---

## 3. Music server browser

`apps/overlay-ui/src/lib/navidrome/client.ts` — a thin typed wrapper, own Zod schemas at the
boundary (consistent with how `TauriSpotifyPoller` validates IPC payloads):

| Need | Endpoint |
| --- | --- |
| Artist list (alphabet-indexed) | `getArtists` |
| Albums for an artist | `getArtist` |
| Songs for an album | `getAlbum` |
| Playlists | `getPlaylists` / `getPlaylist` |
| Search | `search3` (`artistCount`/`albumCount`/`songCount`, debounced ~250 ms) |
| Browse shortcuts | `getAlbumList2` (`newest`, `frequent`, `random`, `starred`) |
| Artwork | `getCoverArt?id=<coverArt>&size=96` |

**`ServerLibraryScreen` is a drill-down stack in local React state** (`Artists → Albums → Songs`,
plus a Search tab and a "Recent/Random" tab) — no router, matching the repo's conventions. The
window is 180 px wide, so it is a vertical list, not a grid.

Reuse the existing scroll pattern verbatim from `IdleScreen.tsx:117-131`: `.thin-scrollbar`,
`flex: 1` + `minHeight: 0` + `overflowY: auto`, with a pinned `flexShrink: 0` footer holding the
back button and current-path crumb. Rows are ~28 px, 9-10 px font, 24 px cover thumbnail, title
on line 1 and artist/duration on line 2, `text-overflow: ellipsis`.

Paginate at 100 items per fetch (`getAlbumList2` caps at 500) with an "…load more" footer row.
No virtualization — the existing `LeaderboardPanel` doesn't virtualize either, and drill-down
keeps lists short.

Artwork: cache `getCoverArt` URLs in a `Map<coverArtId, string>`; the browser HTTP cache handles
the rest. Tracks over `SERVER_MAX_TRACK_MS = 12 * 60_000` render disabled with a "too long to
analyze" hint.

Selecting a song emits `{ trackId: "nd:<subsonicId>", track, isPlaying: false, positionMs: 0,
source: "server" }`. The `nd:` prefix guarantees no collision with Spotify IDs in the leaderboard,
the chart cache, or the many `playback.trackId !== chart.trackId` comparisons.

---

## 4. Playback

### The clock seam

`calibratedPlaybackMs()` in `apps/overlay-ui/src/lib/playbackPosition.ts` is the single funnel —
only two consumers (`useGameLoop.ts:14`, and `NoteHighway.tsx` via the already-inverted
`registerNoteHighwayPlaybackClock`). It becomes:

```ts
export function calibratedPlaybackMs(): number {
  const src = activePlaybackSource();
  const s = useGameStore.getState().settings;
  const offset = src?.id === "server"
    ? s.serverPlaybackTimingOffsetMs
    : s.playbackTimingOffsetMs;
  return activePlaybackClock().estimateMs() + offset;
}
```

Separate offsets because the Spotify value bakes in report/anchor bias; sharing it would wreck a
carefully calibrated Spotify setting the moment a local track plays. `packages/note-highway`
needs **zero** changes. Also route `OffsetCalibrator.tsx:167` through `activePlaybackClock()` so
calibration works in both modes.

`PlaybackClock` is a discriminated union on `isExact`, not an optional `sync?`, so
`if (clock.isExact) return;` narrows cleanly with no casts under `exactOptionalPropertyTypes`:

```ts
export interface ExactPlaybackClock {
  readonly isExact: true;
  estimateMs(): number;
  reset(): void;
}
export interface ExtrapolatedPlaybackClock {
  readonly isExact: false;
  estimateMs(): number;
  reset(): void;
  sync(positionMs: number, isPlaying: boolean, trackId: string | null): void;
}
export type PlaybackClock = ExactPlaybackClock | ExtrapolatedPlaybackClock;
```

`PlaybackSource` is **one** interface covering clock + transport + capabilities, not two
registries that can disagree about which mode is live:

```ts
export interface PlaybackSource {
  readonly id: "spotify" | "server";
  readonly capabilities: {
    exactClock: boolean;
    /** Arbitrary seek is exposed to gameplay/UI. FALSE for both sources in v1. */
    seek: boolean;
    localVolume: boolean; emitsTransportEvents: boolean;
  };
  readonly clock: PlaybackClock;
  start(): void; stop(): void;
  play(): Promise<void>; pause(): Promise<void>;
  /** Internal in v1: only ever called with 0, by restart(). Not UI-reachable. */
  seek(positionMs: number): Promise<void>;
  restart(): Promise<void>;
  setVolume(unit01: number): Promise<void>;   // no-op when !localVolume
  onEvent(cb: (ev: PlaybackSourceEvent) => void): () => void;
}
// PlaybackSourceEvent = {type:"state",state} | {type:"restarted"} | {type:"ended"}
// No "seeked" event in v1 — nothing can emit one, and a dead event means a dead
// branch in useGameLoop. Add it together with practice mode, not before.
```

`SpotifyPlaybackSource` is a **façade over existing code** — it does *not* own polling.
`useSpotifySync` keeps calling `clock.sync()` and `setPlayback()` exactly as today. The
abstraction is only as deep as Mode 1 requires.

### Playback mechanism: `decodeAudioData` + `AudioBufferSourceNode`

Rejected `<audio>.currentTime` (coarsened, non-monotonic across rAF frames — you'd have to put an
extrapolation layer back on, which is the thing Mode 1 exists to delete) and `<audio>` +
`MediaElementAudioSourceNode` (still needs the coarse `currentTime` to establish the mapping).

The decisive argument is sequencing: **we must decode to analyze, and gameplay cannot start
without the chart**, so "full download before play" costs nothing — it is already on the critical
path. In exchange the clock is trivially exact:

```
playheadMs = (ctx.currentTime - startedAtCtxTime) * 1000 + startOffsetMs - outputLatencyMs
```

`AudioBufferSourceNode` can't pause/resume, so wrap it: pause = `node.stop()` + freeze
`pausedAtMs`; resume = fresh node + `start(ctx.currentTime + 0.02, pausedAtMs / 1000)` with a new
anchor. Seek and restart are the same operation with a different offset. The clock returns
`pausedAtMs` verbatim while paused.

Chain: `AudioBufferSourceNode → GainNode → destination`. `setVolume` writes `gain.gain.value` and
emits a state event with `volumePercent = round(v * 100)` so the HUD stays truthful.

**Share one `AudioContext` with `hitSound.ts`** via a new `lib/audioContext.ts` singleton: the
existing `primeHitSound()` unlock (`useKeybinds.ts`) then also unlocks music, and SFX can never
drift against the music. Use `ctx.outputLatency || ctx.baseLatency || 0`, letting
`serverPlaybackTimingOffsetMs` absorb the residue.

Memory: a 4-min stereo buffer at 48 kHz Float32 is ~92 MB. Hold exactly one `AudioBuffer`, null it
on track change, and let the fetched `ArrayBuffer` detach at decode. The 12-minute cap avoids
shipping a second `<audio>`-based path in v1.

### Ordering contract with the store

Three concrete requirements, derived from reading `setPlayback` and `onScoreEvents`:

1. **On pause, keep emitting the same `trackId`** with `isPlaying: false`. `onScoreEvents`
   (`game-state/src/index.ts:329`) silently drops events when `playback.trackId !==
   chart.trackId`, and the loop bails at `useGameLoop.ts:373`.
2. **"Back to library" calls `resetRound()`**, not `setPlayback({trackId: null})` — the latter
   lands in `phase: "paused"` with no track, a dead end. No store change needed.
3. **Do not start audio at selection.** The source exposes `prepare(track)` (fetch → decode →
   analyze, emitting `isPlaying: false, positionMs: 0`); audio starts when `phase` reaches
   `autoplay`. Otherwise you play several seconds of music with no chart.

### Store additions (keep minimal)

`analysisProgress: number | null` and `analysisStage: "downloading" | "decoding" | "analyzing" |
"charting" | null`, rendered in the existing `trackLifecycle === "generating"` branch
(`App.tsx:107-120`). **No new `TrackLifecycleState` value** — `loading` = downloading,
`generating` = decode + analyze + chart is a correct reading of the existing enum. Navidrome auth
state stays in a local `useNavidromeAuth()` hook, not the store.

### `PlaybackState` — reuse it, generalize the schema

Reusing `PlaybackState` verbatim is what makes the loop, highway, HUD, results and leaderboard
work with **zero** changes. Do not add a parallel field. In `packages/shared-types/src/index.ts`:

```ts
export const TrackSchema = z.object({ /* today's SpotifyTrackSchema */
  album: z.string().optional(),   // library UI wants it; harmless
});
/** @deprecated use TrackSchema — kept so existing imports keep compiling. */
export const SpotifyTrackSchema = TrackSchema;

export const PlaybackStateSchema = z.object({
  ...,
  track: TrackSchema.nullable(),
  /** Absent = spotify. Consumers must treat undefined as "spotify". */
  source: z.enum(["spotify", "server"]).optional(),
});
```

`optional()` (not `.default("spotify")`) so every existing `setPlayback` call site still
type-checks under `exactOptionalPropertyTypes`. The rename is cheap — **only 5 references in the
repo** (`shared-types/src/index.ts` ×3, its README, `useChartGeneration.ts` ×2).

`track.bpm` stays absent for server tracks; `Chart.bpm` carries the analysis tempo estimate, and
nothing reads `track.bpm` except `demoBeatEvents`, which the server path doesn't use.

**Do not put the credentialed stream URL in `PlaybackState`** — it would leak into any diagnostics
dump. Build URLs in the navidrome client from the raw id.

### Transport UI

`ServerTransportControls` renders **inside the existing `PlayBottomBar`**, gated on
`playback?.source === "server"` — the window is 180×420 and a second row would eat the highway.
Icon-only, 8-10 px: **play/pause, restart, volume, back-to-library. No scrub bar.**

### Why no scrubbing (decided — do not reopen during implementation)

The mechanism is free: `start(when, offset)` makes seek the same call as restart with a different
offset. The cost is entirely on the scoring side, and three arguments settle it:

1. **Leaderboard integrity.** Scores go to a shared Supabase leaderboard
   (`packages/leaderboard-client`). Mid-song seeking lets a player skip hard sections or jump
   backward to farm an easy high-multiplier passage. Shipping it honestly therefore means
   shipping it *plus* a way to mark the run unranked — a `runInvalidated` concept that does not
   exist in the store today. That is strictly **more** work than omitting seek, not less. Note the
   existing replay detection already resets the round for exactly this reason.
2. **It is incoherent for the genre.** Clone Hero and Guitar Hero have no mid-song seek. A score
   for a run where notes went by unplayed does not mean anything.
3. **Restart covers the realistic case** and is already in the plan for free.

The legitimate version of the underlying desire is a **practice mode** (section looping, slowdown,
explicitly unscored) — a real feature, deliberately out of scope here. When it is built, it is a
pure addition: set `capabilities.seek: true`, add the `{type:"seeked"}` event, add
`ScoringEngine.resolveSilentlyBefore(positionMs)`, and gate scoring off for practice runs.

Consequences for this plan: **do not add `ScoringEngine.resolveSilentlyBefore()`** (nothing would
call it), and `useGameLoop` needs no forward-seek handling. The backward-jump replay heuristic
still stays — it is load-bearing for Mode 2.

---

## 5. Authentication & security

`apps/overlay-ui/src/lib/navidrome/credentials.ts`, own Zod schema, own localStorage key
`spotifyHero_navidrome_v1` — deliberately **not** in `AppSettingsSchema`, which gets re-parsed on
every `updateSettings`, is partly mirrored to Tauri, and is the obvious thing to dump into a
diagnostics panel.

```ts
export const NavidromeCredentialsSchema = z.object({
  serverUrl: z.string().url(),
  username: z.string().min(1),
  salt: z.string().min(8),
  token: z.string().length(32),   // md5(password + salt)
});
```

**Be honest about what this is.** `md5(password + salt)` with a fixed salt is a
password-equivalent bearer credential; storing it instead of the password avoids the word
"password" in the blob but is not meaningfully safer. The real fix is the OS keychain via a Tauri
command. Comment it as a deliberate v1 compromise with a TODO — do not let it read as a security
measure. This is no worse than the status quo: Spotify access/refresh tokens already sit
unencrypted in `settings.json`.

md5: hand-roll `lib/navidrome/md5.ts` (~60 lines, pure, RFC 1321 test vectors) rather than adding
a dependency to a Tauri app. Optional hardening worth doing at the same time: a Rust command
`navidrome_auth_token(password, salt)` using the `md-5` crate, so the plaintext password never
enters JS at all — one `commands.rs` entry plus one `generate_handler!` line.

### Networking notes

- **CORS is solved** — verified `*` on `ping`, `stream`, and `getCoverArt`, with preflight passing.
- **HTTPS throughout** (Cloudflare in front), so credentials in the query string are inside TLS.
  They will appear in Cloudflare/Navidrome access logs — accepted, and the reason to prefer the
  derived token over the raw password.
- **A failed `stream` returns HTTP 200 with `content-type: application/xml`.** Check content-type
  before `decodeAudioData`, or you decode an error document. Same for `getCoverArt`.
- Use `format=raw` so playback and analysis see identical bytes and no transcoder delay enters.
- The server advertises `transcodeOffset`, so `timeOffset` seeking works for music if a streaming
  path is ever needed — not required by the buffer-based design.
- Optional: `scrobble` with `submission=true` after a completed song, since `stream` explicitly
  does not count plays.

**Security posture**: the game is a client of an already-internet-exposed server, using a normal
user account. It adds no new exposure. Worth doing: create a **dedicated Navidrome user** for the
game so its credential is independently revocable.

---

## 6. UI/UX

Styling follows the house pattern — CSS variables plus inline style objects, no new dependency.
Font scale 8-13 px, `minHeight: 0` at every flex level.

**`SourcePicker`** (`phase === "idle"`, `musicSource === null`), stacked vertically for 180 px:

```
┌────────────────────┐
│   spotifyHero      │
│                    │
│ ┌────────────────┐ │
│ │  ♪  MY LIBRARY │ │  ← accent border (--accent-library), listed first
│ │  Your music    │ │
│ │  server        │ │
│ └────────────────┘ │
│ ┌────────────────┐ │
│ │  Spotify       │ │  ← muted/secondary styling
│ │  Use your own  │ │
│ │  account       │ │
│ └────────────────┘ │
└────────────────────┘
```

Mode 1 is visually primary: accent-bordered, larger, first. Mode 2 is a muted secondary card.

**`ServerLibraryScreen`** — sticky search field, a three-way tab strip
(`Browse | Search | Recent`), scrolling list body, pinned footer with back/crumb. Drill-down
replaces the list in place rather than pushing a new screen.

**Fitting in visually**: the existing accent `--accent: #1db954` is Spotify green. Mode 1 should
get its own `--accent-library` in `global.css` so the library mode doesn't look like Spotify — a
small change that does a lot of the "this is its own thing" work. During gameplay Mode 1 looks
identical to today: same HUD, same highway, same results.

---

## 7. Implementation steps

### Phase 0 — Safety net (no behaviour change)
Move `PlaybackClockImpl` from `apps/overlay-ui/src/lib/playbackClock.ts` into
`packages/audio-engine/src/extrapolatingClock.ts`; leave a one-line shim behind (matching the
repo's existing shim convention). Write `packages/audio-engine/src/__tests__/extrapolatingClock.test.ts`
covering the `IGNORE_DRIFT_MS = 135` branch, track change, play/pause, paused-follow.
**Its own commit** — this is the untested thing the entire game hangs on.
*Test*: `pnpm test`, `pnpm type-check`, then `pnpm dev:desktop` and confirm Spotify play is unchanged.

### Phase 1 — Navidrome client (backend/API, no gameplay)
`lib/navidrome/{md5,credentials,client}.ts`. Zod at the boundary; URL builder; content-type guard
on binary endpoints.
*Test*: `md5.test.ts` with RFC 1321 vectors; `client.test.ts` against recorded JSON fixtures
(node, no DOM). Manually: a temporary dev-only button that logs in and dumps `getArtists`.

### Phase 2 — Mode selection + library browser (frontend, mock playback)
`AppSettingsSchema` additions; `PlaybackStateSchema` gains `source?`; `SpotifyTrackSchema` →
`TrackSchema` with a deprecated alias. `SourcePicker`, `NavidromeLoginForm`,
`ServerLibraryScreen`. The three Spotify guards from §2. Selecting a song only logs.
*Test*: `pnpm dev:ui` in a browser — full browse/search/drill-down works with no Tauri.
`pnpm test` for the store; confirm picking Spotify still reaches today's `IdleScreen`.

### Phase 3 — Playback source abstraction + real audio
`packages/audio-engine/src/playbackSource.ts`; `lib/playback/activeSource.ts`;
`SpotifyPlaybackSource` façade; `NavidromePlaybackSource`; `lib/audioContext.ts` shared with
`hitSound.ts`; `useActivePlaybackSource` mounted **first** in `App.tsx`;
`calibratedPlaybackMs()` rewrite; `ServerTransportControls`. Chart still from the synthetic grid
at this stage, so audio and scoring can be validated independently of analysis.
*Test*: select a song → it plays, play/pause works, restart works, volume works. Verify
`ctx.outputLatency` is non-zero on macOS **and** Windows. Confirm Spotify mode is untouched.

### Phase 4 — Onset analysis
`packages/onset-analysis` (`fft`, `window`, `spectralFlux`, `peakPicking`, `tempo`, `pitch`,
`analyzeOnsets`). `fftSize = 2048`, `hopSize = 512` → 11.6 ms hop, ~±6 ms localization,
comfortably inside `DEFAULT_HIT_WINDOWS.perfect` (40 ms). ~20,700 frames for a 4-min track,
roughly 0.6-1.5 s of tight preallocated-FFT work. **Not `OfflineAudioContext`** — there is no
spectral-flux node and wrapping the DSP in an `AudioWorklet` would destroy node testability.

Entry point (pure, `Float32Array` in — this is what keeps it node-testable):

```ts
export function analyzeOnsets(
  mono: Float32Array, sampleRate: number, opts?: OnsetAnalysisOptions
): { events: BeatEvent[]; bpm: number; beatPhaseMs: number;
     normalizationProfile: "quiet"|"balanced"|"loud"; durationMs: number };
```

Run it in a Worker (`lib/analysis/onsetWorker.ts`, Vite `new Worker(new URL(...), {type:"module"})`):
decode and downmix on the main thread (`decodeAudioData` isn't reliably available in a Chromium
worker and doesn't block anyway), then `postMessage(mono, [mono.buffer])` for zero-copy transfer.
Progress every ~256 frames.

Then `useServerChartGeneration.ts` (new hook, fires only on `source === "server"`) and
`lib/chartCache.ts` — three tiers: in-memory analysis cache (1-2 entries; makes a difficulty
change re-run only `generate()`, skipping download+decode+analyze entirely), in-memory chart LRU
(~8), and a `localStorage` chart LRU (~10, validated with `ChartSchema.parse` on read so a schema
change self-evicts). **Never persist `BeatEvent[]`** — 20 k events blows the quota.

Three traps to respect:
- **`amplitude`/`rms` must be absolute, not per-track normalized** — `applySilenceGate` compares
  against absolute thresholds (`enterAmplitude: 0.045`), so normalizing means intros/outros get
  charted. Easiest thing to get wrong.
- **Emit a full `isBeat` grid** from `bpm` + `beatPhaseMs`. `buildRhythmContext` needs ≥ 4
  `isBeat` events and takes `beatTimes[0]` as `gridStartMs`; otherwise it silently falls back to
  `gridStartMs = 0`, which is exactly the misalignment being fixed.
- **No 2000 ms bias.** Real onset times are used verbatim.

Pass the computed `normalizationProfile` into `ChartGeneratorOptions` — the generator already
scales its gate by it, so adaptive gating is free. Use conditional spread for `pitchHz`
(`...(hz ? { pitchHz: hz } : {})`) per the `exactOptionalPropertyTypes` house style.

*Test*: `packages/onset-analysis/src/__tests__/` with synthetic click trains at known BPM (assert
detected onsets within ±12 ms and BPM within ±1), sine sweeps for `pitchHz`, silence for the gate.
Then end-to-end on real tracks across genres; verify charts *feel* aligned, which is the actual
acceptance criterion.

### Phase 5 — Loop adaptation
One ref, refreshed in the `[chart]` effect and the loop prologue:
`exactClockRef.current = activePlaybackClock().isExact`. One boolean, never `if (mode === "server")`.

| Item | Action |
| --- | --- |
| `syncClockToStorePlayback` (`:120-128`) | `if (clock.isExact) return;` — guards **all four** `sync()` call sites at once |
| `FINISH_STALE_WAIT_FRAMES = 180` | Add `EXACT_FINISH_STALE_WAIT_FRAMES = 2`, selected by the ref. Removes the ~3 s artificial delay before results — the most visible win. Not 0: `allNotesResolved` needs a frame to settle |
| `CHART_MOUNT_STALE_MS` block (`:411-424`) | Add `!exactClockRef.current &&` to the condition. Constant untouched |
| Early tail resync (`:426-435`) | Same guard. Constant untouched |
| Replay detection (`:444-467`) | **Add** an event-driven `restartSeqRef` path checked *before* the position heuristic; **keep** the backward-jump heuristic as the `else`. It is load-bearing for Mode 2, and stays as a safety net for a Mode-1 restart whose event was missed |
| Forward seek | **Nothing to do — decided out of v1** (see "Why no scrubbing", §4). Do **not** add `ScoringEngine.resolveSilentlyBefore()`; nothing would call it. Restart is handled by the `restarted` event path above |
| `playbackVolumeGate` | Gate on `playback.source === "server"` → return `false`. Must be a pure function of `PlaybackState` because `packages/note-highway/src/playbackVolumeGate.ts` is a **second copy** with no access to the source registry. Two trivial edits |
| `resumeSpotifyPlayback()` at `:369` | → `void activePlaybackSource()?.play()` |
| `EXPERT_HIT_WINDOWS` (88/108/138/188) | **Leave alone.** Padded for Spotify jitter and an exact clock could justify tightening, but hit windows are the highest-risk feel change here and per-mode windows make leaderboard scores incomparable. Add a TODO; separate PR |
| `CHART_FINISH_PAD_MS`, both sustain graces, `MODE_SWITCH_HOLD_GRACE_MS`, `AFK_MISS_THRESHOLD`, `scoreClampMs` | **Leave alone** — input-hardware and product concerns, not timing-source concerns |

*Test*: `pnpm test`; play a Mode 1 song end-to-end (results appear promptly); restart mid-song;
pause/resume; mute; then a full Mode 2 Spotify session to confirm no regression.

### Phase 6 — Polish
Analysis progress UI, `--accent-library` theming, Mode 1 diagnostics reusing the `Ctrl+Shift+D`
`SpotifyDiagnosticsPanel` pattern to surface `FeatureExtractionStats` (needed for confidence
tuning), settings row to switch modes, README/`docs/` updates.

---

## 8. Potential problems

**Resolved by probing** (were the top risks): CORS on `/rest/stream` — verified `*`. Whether
Substreamer is needed — it is not, it's a client. Whether an API key is available — it is not, so
salted-token it is.

**Needs verification during implementation:**

1. **`format=raw` honoured by Navidrome 0.63.2.** It's a documented Subsonic parameter, but may be
   gated by server-side transcoding policy. If raw is refused, analysis and playback must request
   *the same* transcode so the ~13 ms MP3 encoder delay cancels out.
2. **Browser codec support for the actual library.** Tauri uses WebView2/Chromium on Windows but
   **WKWebView on macOS**, where `decodeAudioData` coverage for FLAC and especially Opus/Ogg is
   weaker. Check what formats the library actually holds; the fallback is requesting an mp3
   transcode (see #1).
3. **`AudioContext.outputLatency`** is 0 or undefined on some platforms. Fall back to
   `baseLatency`, verify on macOS and Windows.
4. **`hitSound.ts` context options** — confirm it doesn't construct its `AudioContext` with
   options that conflict before sharing it.
5. **Memory RSS in the real Tauri build.** 92 MB per buffer in an overlay expected to sit resident
   for hours; the 12-minute cap is a guess until measured.

**Known tuning unknown — expect an iteration:** mapping spectral-flux salience to `confidence`.
`DIFFICULTY_PARAMS` was tuned against the synthetic grid's distribution (0.94 / 0.71 / 0.34) and
uses thresholds like `sustainConfidenceMin: 0.68-0.72`. Real flux has a different shape, so Easy
charts could come out empty and sustains unassigned. Floor grid-aligned strong peaks near 0.9 and
plan to tune with the Phase 6 diagnostics panel.

**Accepted limitations:** credential storage is localStorage, not the keychain (§5); no queue or
gapless playback; **no mid-song scrubbing and no practice mode** (§4); `Child.duration` is
second-granular so `scoreClampMs` could clamp up to ~999 ms early — use the decoded buffer's exact
duration instead; long tracks are refused rather than streamed.

---

## Verification

```bash
pnpm build && pnpm type-check && pnpm test     # after every phase
pnpm --filter @spotifyhero/onset-analysis exec vitest run
cd apps/desktop/src-tauri && cargo check        # only if the md5 Rust command is added
```

Remember `pnpm build` before `pnpm dev:ui` — workspace packages resolve through `dist/`, so a new
`onset-analysis` package won't resolve until compiled.

**Mode 1 end-to-end** (`pnpm dev:desktop`): pick "My Library" → log in → browse artists → albums
→ songs → select → progress shows download/analyze → chart appears → audio plays through the game
→ notes align with what you hear → play/pause, restart and volume work → song ends → results
appear promptly (not after a 3 s stall) → back to library. Confirm there is **no** scrub bar and
no way to reach an arbitrary position mid-song.

**Mode 2 regression** (the important one): switch to Spotify in settings → `IdleScreen` appears →
connect → press play in Spotify → chart generates → play a full song → results. Confirm nothing
about feel, timing, or recovery behaviour changed. Also `pnpm dev:ui` with `window.__mockPoller`.

**Browser-only Mode 1** (`pnpm dev:ui`, no Tauri): browsing, login, analysis, and playback should
all work, since everything is renderer-side `fetch` + Web Audio. This is the fast dev loop and a
deliberate property of the architecture.
