# @spotifyhero/note-highway

Canvas 2D note highway renderer for spotifyHero — decoupled from the overlay-ui shell so it can be tested headlessly or swapped for an alternative renderer (WebGL, server-side, etc.).

## What's in here

- `NoteHighway` — the React + Canvas 2D note highway component
- `registerNoteHighwayPlaybackClock(fn)` — inject the calibrated playback position getter
- `shouldHideNotesForQuietPlayback` / `isSpotifyPlaybackTooQuietForNotes` — volume gate utilities

## Why a separate package?

The renderer has no dependency on the Tauri shell, Spotify polling, or chart generation. Extracting it means:

- Renderer can be unit-tested in isolation with a mock store and clock
- A WebGL or alternative renderer can be swapped in without touching the game logic
- The package boundary makes the data contract (shared-types + game-state) explicit

## Usage

```ts
// In the consuming app (e.g. overlay-ui):
import { registerNoteHighwayPlaybackClock } from "@spotifyhero/note-highway";
import { calibratedPlaybackMs } from "./lib/playbackPosition.js";

// Register the clock once at app init
registerNoteHighwayPlaybackClock(calibratedPlaybackMs);

// Then use the component as normal — no props needed
import { NoteHighway } from "@spotifyhero/note-highway";
// <NoteHighway />
```
