# @spotifyhero/audio-engine

Audio capture, Spotify playback polling interface, and timing/drift correction utilities.

## Purpose
Abstracts audio timing and Spotify state so the UI and game loop remain transport-agnostic.

## Key exports
- `SpotifyPoller` / `MockSpotifyPoller` – playback state polling interface + testable mock.
- `BeatTracker` – interface implemented by the Rust backend.
- `DriftCorrector` – running drift estimate between Spotify position and wall clock.
- `LatencyCalibrator` – per-device latency measurement interface.

## Commands
```bash
pnpm lint    # tsc type-check
pnpm build   # compile to dist/
pnpm test    # vitest
```
