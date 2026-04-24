# scripts/

Helper scripts for building, releasing, and distributing spotifyHero.

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
