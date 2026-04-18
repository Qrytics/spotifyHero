# @spotifyhero/leaderboard-client

API client for leaderboards and challenge sharing, backed by Supabase.

## Purpose
Submits scores, fetches leaderboards, and builds shareable challenge URLs.

## Key exports
- `LeaderboardClient` – interface.
- `SupabaseLeaderboardClient` – production Supabase REST implementation.
- `OfflineLeaderboardClient` – in-memory fallback for offline / demo use.

## Configuration
Provide `supabaseUrl` and `supabaseAnonKey` in `AppSettings` (via Tauri store or env).
When not configured, the app falls back to `OfflineLeaderboardClient` automatically.

## Commands
```bash
pnpm lint    # tsc type-check
pnpm build   # compile to dist/
pnpm test    # vitest
```
