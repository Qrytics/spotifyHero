# spotifyHero Web

The web edition, served at `https://mario-belmonte.com/games/spotifyHero` (the portfolio proxies
that path here; see its `vercel.json` / `Caddyfile`).

## How a song gets played

1. **YouTube link → mp3, on the server** — `POST /api/youtube/audio` (`lib/youtubeAudio.ts`):
   youtubei.js resolves the audio stream, it is fetched in ranged chunks and transcoded with
   `ffmpeg-static`. The bitrate is sized to stay under Vercel's ~4.5 MB response cap (128 kbps up
   to ~4 min, down to 64 kbps at the 9-minute limit). Nothing is stored; the response is `no-store`.
2. **mp3 → chart, in the browser** — exactly the desktop app's *My Library* pipeline:
   `decodeAudioData` → mono downmix → `@spotifyhero/onset-analysis` in a Web Worker →
   `HybridChartGenerator` from `@spotifyhero/chart-generator` (`lib/client/analyze.ts`).
3. **Shared charts** — before analysing, the client asks `GET /api/charts` for a stored chart for
   (video, difficulty, pipeline version); a fresh chart is `POST`ed back, first writer wins. So
   everyone on a leaderboard plays the same notes, and bumping either package's version re-charts.
4. **Play** — Web Audio with an exact, latency-compensated clock and a 3-beat count-in
   (`lib/client/songPlayer.ts`, a port of the desktop `NavidromePlaybackSource`), the real
   `@spotifyhero/note-highway`, and `ScoringEngine` from `@spotifyhero/gameplay-core`, judged the
   way `apps/overlay-ui/src/hooks/useGameLoop.ts` judges. Keys: D F J K, Space/Esc to pause.

## Accounts and leaderboards

Guests can play; signed-in players' scores are ranked per chart (`sh_charts`, `sh_chart_scores`).
Without `POSTGRES_URL` the game still works — charts stay local and runs are unranked.

## Env vars

- `POSTGRES_URL` — Vercel Postgres (optional; enables shared charts, accounts, leaderboards)
- `SH_AUTH_SECRET` — long random string for the signed auth cookie

## Local dev

```bash
pnpm install
pnpm --filter "spotifyhero-web^..." run build   # the workspace packages this app imports
pnpm --filter spotifyhero-web dev
```

Then open `http://localhost:3000/games/spotifyHero`. `pnpm --filter spotifyhero-web build` builds
the packages first on its own (that is what Vercel runs).

## Known limits

- YouTube rate-limits and periodically blocks data-centre IPs; when it does, the converter returns
  a clear error instead of a chart. Which InnerTube client works changes over time — see `CLIENTS`
  in `lib/youtubeAudio.ts`.
- Songs over 9 minutes and live streams are refused.
