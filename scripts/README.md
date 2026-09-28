# scripts/

Helper scripts for building, releasing, and distributing spotifyHero.

---

## setup/

| Script | How to run | What it does |
|--------|-----------|--------------|
| `setup.js` | `pnpm run setup` | Checks Node ≥ 20 and pnpm ≥ 9, installs dependencies (skipping the isolated `spotifyhero-web` app and its ~80 MB ffmpeg postinstall, falling back to a full install if the filter is refused), then builds `packages/*` in topological order. Warns if `cargo` is missing. |
| `setup.js --build-only` | `pnpm run build:packages` | Just the package build, no install. This is what `tauri.conf.json`'s `beforeDevCommand` / `beforeBuildCommand` call, which is why `pnpm play` and `pnpm build:desktop` work on a checkout where nothing has been built. |

Use `pnpm run setup`, not `pnpm setup` — the latter is pnpm's own built-in command.

Everything goes through `execFileSync` with an argv array rather than a shell: the pnpm
filters (`--filter=!spotifyhero-web`, `--filter=./packages/**`) would otherwise need
different quoting in cmd.exe, PowerShell and sh.

---

## build/

| Script | How to run | What it does |
|--------|-----------|--------------|
| `generate-tauri-app-icon.ps1` | `pwsh scripts/build/generate-tauri-app-icon.ps1` | Generates all required Tauri app icon sizes from a source PNG. Run once when the icon changes. |

---

## release/

| Script | How to run | What it does |
|--------|-----------|--------------|
| `itch-push.js` | `pnpm itch:push` (from repo root) | Uploads the Windows NSIS installer to itch.io via [butler](https://itch.io/docs/butler/). |
| `itch.env.example` | Copy to `scripts/release/itch.env` and fill in | Local config file for `ITCH_USER` and `ITCH_GAME`. Not committed to git. |

### itch.io release workflow

1. Copy `scripts/release/itch.env.example` → `scripts/release/itch.env`
2. Set `ITCH_USER` and `ITCH_GAME` (your itch username and game slug).
3. Build the desktop app: `pnpm build:desktop`
4. Upload: `pnpm itch:push`

Or do both steps at once: `pnpm itch:release`
