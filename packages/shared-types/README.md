# @spotifyhero/shared-types

Shared Zod schemas and TypeScript types used across all spotifyHero packages.

## Purpose
Single source of truth for all data shapes exchanged between the UI, game engine, audio system, leaderboard client, and Tauri backend.

## Entrypoints
- `src/index.ts` – all exports (types + schemas).

## Key exports
- `TrackSchema`, `Track` (`SpotifyTrackSchema` / `SpotifyTrack` are deprecated aliases)
- `PlaybackStateSchema`, `PlaybackState` — `source?: "spotify" | "server"`, **undefined means spotify**
- `MusicSourceSchema`, `MusicSource`
- `NoteSchema`, `Note`, `ChartSchema`, `Chart`
- `GameSessionSchema`, `GameSession`
- `LeaderboardSchema`, `LeaderboardEntrySchema`
- `ChallengePayloadSchema`
- `AppSettingsSchema`, `WindowSettingsSchema`

## Commands
```bash
pnpm lint    # tsc type-check
pnpm build   # compile to dist/
pnpm test    # vitest
```
