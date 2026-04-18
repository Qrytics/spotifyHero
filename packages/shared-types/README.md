# @spotifyhero/shared-types

Shared Zod schemas and TypeScript types used across all spotifyHero packages.

## Purpose
Single source of truth for all data shapes exchanged between the UI, game engine, audio system, leaderboard client, and Tauri backend.

## Entrypoints
- `src/index.ts` – all exports (types + schemas).

## Key exports
- `SpotifyTrackSchema`, `SpotifyTrack`
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
