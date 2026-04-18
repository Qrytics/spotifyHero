# apps/overlay-ui

React + PixiJS note highway and heads-up display for spotifyHero.

## Purpose
Renders the game overlay: falling note highway, score HUD, results screen, and idle screen.
Communicates with the Tauri backend via `@tauri-apps/api` `invoke()`.

## Entrypoints
- `src/main.tsx` – React root.
- `src/components/App.tsx` – top-level component, wires all hooks.

## Key hooks
- `useSpotifySync` – drives playback state from poller.
- `useGameLoop` – per-frame scoring + autoplay.
- `useKeybinds` – Space toggle + lane keys.

## Key components
- `NoteHighway` – PixiJS canvas renderer.
- `HUD` – score, combo, track name.
- `ResultsScreen` – post-song breakdown.
- `IdleScreen` – waiting for Spotify.

## State
Managed by Zustand (`src/store/gameStore.ts`).

## Commands
```bash
pnpm dev      # Vite dev server on :1420
pnpm build    # production bundle → dist/
pnpm lint     # tsc type-check
pnpm test     # vitest
```
