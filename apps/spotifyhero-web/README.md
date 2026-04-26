# spotifyHero Web

Separate web deployment of spotifyHero for `https://mario-belmonte.com/games/spotifyHero`.

## Features in this edition

- YouTube URL input with async chart-job queue.
- Chart caching in DB (`sh_song_charts`) by YouTube video ID.
- Leaderboards + most played songs from Vercel Postgres.
- Account mode and Guest mode.
- Guest players can play, but score submission is blocked by API.
- Manual gameplay only (no autoplay toggle in web edition).

## Required env vars

- `POSTGRES_URL` (provided by Vercel Postgres integration)
- `SH_AUTH_SECRET` (long random string for signed auth cookie)

## Local dev

```bash
pnpm --filter spotifyhero-web dev
```

Then open:

- `http://localhost:3000/games/spotifyHero`
