# apps/desktop

Tauri 2 Rust shell for spotifyHero – native window management, Spotify OAuth, and IPC command handlers.

## Purpose
Host the overlay-ui WebView in a small always-on-top desktop window.
Expose native capabilities (Spotify auth, global shortcuts, window persistence) via IPC commands.

## Entrypoints
- `src-tauri/src/main.rs` – binary entry point.
- `src-tauri/src/lib.rs` – Tauri builder + window setup.

## Key modules
- `commands.rs` – IPC commands callable from TypeScript via `invoke()`.
- `spotify.rs` – Spotify Web API client (PKCE auth + polling).
- `settings.rs` – persisted settings struct.

## Window config
`tauri.conf.json` sets: 360×640 default size, 200×400 minimum, `alwaysOnTop: true`.
Position is persisted via `tauri-plugin-store` on each move/resize.

## Commands
```bash
# From repo root:
pnpm dev:desktop      # tauri dev (starts overlay-ui vite server + native window)
pnpm build            # tauri build → produces platform installer

# Rust only:
cd apps/desktop/src-tauri && cargo check
cd apps/desktop/src-tauri && cargo clippy
```

## Dependencies
- `tauri 2` + `tauri-plugin-store` + `tauri-plugin-global-shortcut` + `tauri-plugin-shell`
- `reqwest` for Spotify API HTTP calls
- `tokio` async runtime
