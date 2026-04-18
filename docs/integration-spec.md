# spotifyHero – Integration Specification

## Spotify Web API

### Auth flow
- PKCE OAuth 2.0.
- Scopes required: `user-read-playback-state`, `user-read-currently-playing`.
- Redirect URI: `http://localhost:8888/callback` (loopback, no HTTPS needed for desktop).
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
  created_at    timestamptz default now()
);

create index on leaderboard_entries (track_id, difficulty, score desc);
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
