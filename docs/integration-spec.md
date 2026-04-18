# spotifyHero – Integration Specification

## Spotify Web API

### Auth flow
- PKCE OAuth 2.0.
- Scopes required: `user-read-playback-state`, `user-read-currently-playing`, `user-modify-playback-state`, `user-read-email` (profile + leaderboard name), `user-follow-read` (friend leaderboard via Spotify people you follow).
- Redirect URI: `http://127.0.0.1:8888/callback` (loopback, no HTTPS needed for desktop).
- After changing scopes, the user must **disconnect and connect Spotify again** so Spotify issues a token with the new scopes.
- Tokens stored via `tauri-plugin-store` (encrypted on macOS via Keychain).

### Polling
- Endpoint: `GET /me/player/currently-playing`
- Interval: 500 ms while a track is playing; 5 000 ms on pause.
- Response handling: 204 = no active device (→ idle); 200 = parse track + position.

### Position drift
Spotify positions are approximate. `DriftCorrector` (audio-engine) adjusts by
comparing wall-clock elapsed time against reported position deltas.

## Supabase (leaderboards)

### Required table

```sql
create table leaderboard_entries (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null unique,
  track_id      text not null,
  difficulty    text not null,
  score         integer not null,
  max_combo     integer not null,
  accuracy      real not null,
  played_at     timestamptz not null,
  player_name   text not null,
  judgements    jsonb not null,
  created_at    timestamptz default now(),
  -- Optional: ties scores to Spotify user id for “Friends” filter (people you follow on Spotify)
  spotify_user_id text,
  -- Optional: legacy Supabase auth user id if you use auth-linked rows
  user_id       uuid
);

create index on leaderboard_entries (track_id, difficulty, score desc);
create index if not exists leaderboard_entries_spotify_user_id_idx
  on leaderboard_entries (spotify_user_id)
  where spotify_user_id is not null;
```

If you already created the table without `spotify_user_id`:

```sql
alter table leaderboard_entries add column if not exists spotify_user_id text;
alter table leaderboard_entries add column if not exists user_id uuid;
```

### Row-level security
Enable RLS; allow anonymous inserts and selects (public leaderboard).

### Challenge share URL
`{supabase_url}/challenge?track={trackId}&diff={difficulty}&score={score}&session={sessionId}`

Frontend reads query params and pre-fills a "Beat this!" prompt.

## Distribution

### Itch.io
- Build via `tauri build` → upload the platform-specific installer.
- No additional runtime requirements (Rust ships statically linked).

### Steam
- Steam SDK integration via `steamworks-rs` crate (future phase).
- Achievement hooks sit in `commands.rs`.
- Cloud save for settings can replace `tauri-plugin-store` later.
