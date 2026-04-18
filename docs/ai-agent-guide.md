# spotifyHero – AI Agent Guide

This document tells AI coding agents how to safely navigate, edit, and validate the spotifyHero monorepo.

## Repository map

```
spotifyHero/
  apps/
    desktop/          Tauri 2 Rust shell – native window, Spotify OAuth, IPC commands
    overlay-ui/       React + PixiJS UI – note highway, HUD, scoring display
  packages/
    shared-types/     Zod schemas + TS types.  Edit when adding new data shapes.
    gameplay-core/    Scoring, combo, mode toggle.  No I/O, pure logic.
    audio-engine/     Spotify poller interface + drift correction utilities.
    chart-generator/  Note generation pipeline.  Deterministic first, ML optional.
    leaderboard-client/  Supabase REST + offline fallback.
  services/           Reserved for future edge helpers.
  supabase/migrations/  Leaderboard DDL + RLS (apply in Dashboard SQL Editor).
  docs/               Reference docs.  Update when behaviour changes.
  scripts/setup/      Bootstrap helpers.
```

## Safe edit zones (low blast radius)

- `packages/shared-types/src/index.ts` – add new schemas; do NOT remove or rename existing ones without checking all consumers.
- `packages/gameplay-core/src/index.ts` – pure logic, easy to unit-test.
- `packages/chart-generator/src/index.ts` – deterministic path is safe; ML stub is also safe.
- `apps/overlay-ui/src/components/*.tsx` – isolated React components.
- `docs/*.md` – documentation only.

## High blast-radius zones (be careful)

- `apps/desktop/src-tauri/src/commands.rs` – changes here affect all IPC calls from the UI.
- `apps/overlay-ui/src/store/gameStore.ts` – central state; changes propagate everywhere.
- `apps/desktop/src-tauri/tauri.conf.json` – window config; bad values crash the app.

## Required validation commands

After any TypeScript change:
```bash
pnpm install          # install deps if needed
pnpm lint             # runs tsc --noEmit across all packages
pnpm build            # compiles all packages (excludes Tauri native build)
```

After Rust changes in `apps/desktop/src-tauri/`:
```bash
cd apps/desktop/src-tauri && cargo check
```

## Common troubleshooting

| Problem | Fix |
|---------|-----|
| `Cannot find module '@spotifyhero/…'` | Run `pnpm install` from repo root |
| PixiJS canvas blank | Check that `chart` is non-null in game store before rendering |
| Always-on-top not working | Ensure Tauri window label is `"overlay"` and `alwaysOnTop` is set in conf |
| Score not updating | Confirm `onScoreEvent` is wired in `useGameLoop` and store action is correct |

## Conventions

- All shared data structures go in `packages/shared-types`. Never duplicate types.
- Use `workspace:*` for internal deps in `package.json`.
- All async boundaries must handle errors explicitly (no silent swallows).
- ML refinement path must always have a deterministic fallback.
