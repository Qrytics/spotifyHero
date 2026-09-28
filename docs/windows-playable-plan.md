# Windows-playable-from-zip: approved plan

**Status: implemented 2026-09-28** (same day it was written, against `cda9744`), pushed as
`8718821`, and green on CI: [run #1](https://github.com/Qrytics/spotifyHero/actions/runs/36449364240)
built the NSIS installer on `windows-latest` in 8m55s. One thing still needs a push: no
`v0.0.1` tag has been cut, so the README's `/releases/latest` link is dead. See
[§8 As built](#8-as-built) for the deviations and what remains unverified. The plan
text below is unchanged from approval, so line numbers in it are as of `cda9744` and
some now point at code this change rewrote.

**Goal:** a Windows player either downloads a prebuilt installer from GitHub
Releases and plays, or unzips this repo, installs three prerequisites, runs two
commands, and plays — **reading only `README.md`**.

## Decisions already taken (do not relitigate)

- **Two delivery paths.** README leads with the prebuilt installer; build-from-source
  documented directly below it. CI verifies the source path on every push and
  attaches the installer to tagged releases.
- **Spotify is the documented happy path**, using the player's *own* free Spotify
  app. My Library/Navidrome stays documented as the better-feeling alternative that
  needs a server.

---

## Context: four blockers, only one of them prose

1. **A fresh checkout cannot build the desktop app — on any OS.** Every workspace
   package resolves through a gitignored `dist/` (`main: ./dist/index.js`), but
   `tauri.conf.json`'s `beforeDevCommand`/`beforeBuildCommand` only build
   `overlay-ui`. So `pnpm dev:desktop` and `pnpm build:desktop` both fail on a
   pristine zip because Vite cannot resolve `@spotifyhero/*`. `CLAUDE.md:22`
   records this as a known gotcha; for a player it must not exist.
2. **`bundle.targets: "all"` makes the Windows build fail for a new user.** On a
   Windows host that builds **MSI via WiX v3 as well as NSIS**, and WiX v3 needs
   .NET Framework 3.5 enabled — a classic first-build failure. The MSI is also
   pure waste: `scripts/release/itch-push.js:72-88` only ever looks in
   `bundle/nsis`.
3. **The isolated Next.js web app pollutes setup.** Root `pnpm build` is
   `pnpm -r build`, which drags in `apps/spotifyhero-web` (`next build`), and
   `pnpm install` runs its `ffmpeg-static` postinstall (~80 MB binary download)
   plus `ytdl-core`. A desktop player pays that cost, and risks that failure, for
   an app they will never run.
4. **`README.md` is written for developers and investors.** Its "fast path" ends at
   pasting `window.__mockPoller?.simulatePlay({...})` into a devtools console.
   Windows prerequisites are one parenthetical (`README.md:208`) naming WebView2 but
   never **Visual Studio C++ Build Tools** — the hard requirement for the MSVC
   linker and `ring`'s `cc`-driven build, and the single most likely first-build
   failure. Setup step 1 is `git clone`, with no zip path.

Plus a product-level problem: the Client ID baked into `spotify/config.rs` belongs
to a **development-mode** Spotify app, so a stranger's account gets a 403. The app
already handles this well in-product (`IdleScreen.tsx:10-23` surfaces the hint,
`SettingsPanel.tsx:220-250` accepts a per-machine Client ID) — the README just
buries the explanation at line 213.

### What already works — do not "fix" it

The Tauri/Rust shell needs **no portability changes**. `grep` for
`cfg(target_os)`/`cfg(unix)`/`cfg(windows)` in `apps/desktop/src-tauri/src/` returns
nothing (only `#[cfg_attr(mobile, ...)]` at `lib.rs:13`); `/Users/`, `/tmp/`, `~/`,
`os.homedir`, `home_dir` return nothing repo-wide; no tracked `.sh`; no
package.json script uses a Unix-only tool. `reqwest` uses `rustls-tls` with
`default-features = false`, resolving to `ring 0.17.14` (**not** `aws-lc-sys`,
which would demand NASM + CMake on Windows). OAuth is PKCE over a
`127.0.0.1:8888` loopback listener (`spotify/oauth.rs:136`) — no URL-scheme or
registry protocol handler to register, and loopback-only binding means no Defender
Firewall prompt. Audio is 100% Web Audio; no `cpal`/`rodio`/`symphonia`.
`icons/icon.ico` is a valid multi-size RGBA ICO and is already in the bundle array.
`scripts/release/itch-push.js` is already `process.platform`-aware.

---

## 1. Fix the build order

New **`scripts/setup/setup.js`** — plain CommonJS Node, matching `itch-push.js`'s
style, invoked as `node scripts/setup/setup.js`. Node rather than a package.json
one-liner specifically because `--filter=!spotifyhero-web` and `./packages/**`
globs need shell quoting that differs across cmd.exe, PowerShell and bash; driving
pnpm through `execFileSync` with an **argv array** sidesteps quoting entirely (the
same reason `itch-push.js:123` already uses `execFileSync`).

It should:

1. Check Node ≥ 20 and pnpm ≥ 9, failing with an actionable message naming the
   install command rather than a stack trace.
2. `pnpm install --filter=!spotifyhero-web` — skips the Next.js app, its
   `ffmpeg-static` postinstall and `ytdl-core`. **Fall back to a plain
   `pnpm install` if that exits non-zero.** A filtered install in a workspace can
   trip pnpm's lockfile-freshness check, and skipping the web app is only a speed
   and bandwidth optimisation — the actual blocker (Context §3) is `next build`
   running during `pnpm -r build`, which step 3 avoids by building `packages/*`
   only. Never let the optimisation fail the setup.
3. Build `packages/*` in topological order: `pnpm --filter=./packages/** build`
   (pnpm resolves order from `workspace:*` deps).
4. Accept `--build-only` to skip step 2, and probe for `cargo`, printing a warning
   (not an error) that the desktop app additionally needs Rust + VS C++ Build Tools.

Root `package.json` gains:

```json
"setup": "node scripts/setup/setup.js",
"build:packages": "node scripts/setup/setup.js --build-only",
"play": "pnpm --filter desktop dev"
```

`play` is an alias of `dev:desktop` so the README can say `pnpm play`. Keep
`dev:desktop`, `build:desktop`, `itch:push` and `itch:release` exactly as they are
so the existing release flow is untouched.

Also add **`"packageManager": "pnpm@9.15.9"`**. There is no `packageManager`,
`.nvmrc` or `rust-toolchain.toml` today, so a new user's pnpm major is unpinned;
`pnpm-lock.yaml` is `lockfileVersion: '9.0'`. Corepack and `pnpm/action-setup` both
read this field, keeping the player's pnpm and CI's in agreement.

### `tauri.conf.json` — make the two hooks self-sufficient

- `beforeBuildCommand` → `pnpm run build:packages && pnpm --filter overlay-ui build`
- `beforeDevCommand` → `pnpm run build:packages && pnpm --filter overlay-ui dev`

`&&` is valid in cmd.exe, which is what Tauri uses to run these hooks on Windows.
The dev hook stays long-running as Tauri expects: the build finishes, then Vite
starts and holds.

**Tradeoff:** every `pnpm dev:desktop` now pays a few seconds of `tsc` across eight
packages. That is the price of `pnpm dev:desktop` working standalone, which is what
the README will promise; `tsc` is incremental in practice, and a developer who
wants the old behaviour can still run `pnpm --filter desktop exec tauri dev`.

---

## 2. Windows bundle configuration (`apps/desktop/src-tauri/tauri.conf.json`)

The file currently has **no `bundle.windows` block at all** (29 lines total).

- **Replace `"targets": "all"` with an explicit list**:
  `["nsis", "app", "dmg", "deb", "appimage"]`. Tauri only builds targets applicable
  to the host OS, so this yields NSIS-only on Windows — no WiX, hence no .NET
  Framework 3.5 requirement and no wasted MSI. Keeping `app` and `dmg` preserves
  `itch-push.js`'s macOS branch (`itch-push.js:102-107`), so `pnpm itch:release` is
  unaffected.
- **Add `bundle.windows`:**
  - `"webviewInstallMode": { "type": "embedBootstrapper" }` — the default
    `downloadBootstrapper` needs internet during install on Win10 boxes without
    evergreen WebView2. `offlineInstaller` is bulletproof but embeds ~127 MB; note
    it as the escalation if players report install failures.
  - `"nsis": { "installMode": "currentUser" }` — per-user install, no UAC admin
    prompt. Right default for a game.
- Leave `identifier`/`productName` alone: `spotifyHero` still matches
  `itch-push.js:84`'s `/setup/i` NSIS regex.

The installer is **unsigned**, so Windows SmartScreen shows "Windows protected your
PC" → *More info* → *Run anyway*. README must say so. This is the direct
counterpart of the Gatekeeper warning `itch-push.js:190-196` already prints for
macOS.

---

## 3. Two first-launch bugs to fix in the same pass

**The overlay is not on top on first launch.** `lib.rs:34` builds with
`.always_on_top(false)` and `lib.rs:56-59` reads the store with `.unwrap_or(false)`
— but `settings.rs:24` (`always_on_top: true`), `commands.rs:113
default_always_on_top()` and `AppSettingsSchema`
(`shared-types/src/index.ts:215`, `alwaysOnTop: z.boolean().default(true)`) all say
`true`, and `README.md:408` documents the default as `true`. So the very first
launch of an *overlay* game is not an overlay. **Change `lib.rs:59` to
`.unwrap_or(true)`.**

**`.env` for `SPOTIFY_CLIENT_ID` silently does nothing in a release build.**
`lib.rs:15` resolves it as `Path::new(env!("CARGO_MANIFEST_DIR")).join(".env")` — a
compile-time absolute path from the *build* machine, baked into the shipped binary,
with the error swallowed by `let _ =`. Rather than change the Rust resolution
order, **document it as dev-only** and point players exclusively at the in-app
**Settings → Spotify Client ID** field, which genuinely works
(`config.rs:27-39 resolve_spotify_client_id` reads store key `spotify_client_id`
first, then env, then the built-in default). Update `README.md:214` and
`apps/desktop/src-tauri/.env.example`.

---

## 4. CI and releases

There is **no `.github/` directory at all** today. Add
`.github/workflows/windows.yml` on `push` to `main`, `pull_request`,
`workflow_dispatch`, and `push` of `v*` tags, `runs-on: windows-latest`:

1. `actions/checkout@v4`
2. `pnpm/action-setup@v4` (picks up the new `packageManager` field)
3. `actions/setup-node@v4` — node 20, `cache: pnpm`
4. `dtolnay/rust-toolchain@stable`
5. `Swatinem/rust-cache@v2`, `workspaces: apps/desktop/src-tauri`
6. **`pnpm run setup`** then **`pnpm run build:desktop`**
7. `actions/upload-artifact@v4` of
   `apps/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe`
8. On a `v*` tag only: `softprops/action-gh-release@v2` attaching that `.exe`

**Hand-rolled rather than `tauri-apps/tauri-action`, deliberately:** step 6 is the
*exact pair of commands the README tells a player to run*, so a green build is
direct evidence the documented path works. `tauri-action` runs its own
install/build and would prove something different.

The repo has no release tags yet (only `visuals/classic-2026-09-24`) and version is
`0.0.1` everywhere, so the README download link should point at `/releases/latest`
and **a first `v0.0.1` tag must be cut** or that link is dead.

Also add **`.gitattributes`** with `* text=auto eol=lf`. Nothing breaks today (no
tracked `.sh`), but Git-for-Windows' default `core.autocrlf=true` will cause
line-ending churn the moment a Windows contributor commits.

---

## 5. README.md restructure — the actual deliverable

The test is "playable by reading only `README.md`", so the player path goes
**above** all developer and investor material. New order for the top of the file:

1. Title, badge, one-paragraph what-it-is (keep `README.md:1-13`, trimmed).
2. **▶ Play it on Windows** ← new, everything a player needs, in order:
   - **Option A — download the installer.** Releases link, run it, SmartScreen
     "More info → Run anyway", WebView2 note.
   - **Option B — build it from the repo zip.** Prerequisites as a table with
     download links: **Node ≥ 20**, **pnpm ≥ 9** (`npm i -g pnpm`), **Rust** via
     rustup, and **Visual Studio Build Tools with the "Desktop development with
     C++" workload** — called out as the one people miss. State that the WebView2
     *runtime* ships with Win11/current Win10 and the WebView2 *SDK* is vendored by
     `webview2-com`, so there is nothing extra to install in order to build. Then:
     unzip (or `git clone https://github.com/Qrytics/spotifyHero.git`),
     `cd spotifyHero`, `pnpm setup`, `pnpm play`.
   - **Connect your music → Spotify (recommended).** Numbered, exact:
     1. developer.spotify.com/dashboard → **Create app**
     2. Redirect URI **`http://127.0.0.1:8888/callback`** (exact match required)
     3. Copy the **Client ID** (32 hex characters)
     4. In spotifyHero: **Settings → Spotify Client ID** → paste → Save
     5. **Connect** → press play in Spotify

     One line on *why*: the built-in Client ID is a development-mode app, so only
     allowlisted accounts get past a 403. Note Premium is *recommended for timing*,
     not required (`IdleScreen.tsx:159`), and list the scopes requested
     (`oauth.rs:20`) so players know what they are granting.
   - **Or: My Library (Navidrome).** Short — link to the existing "Music sources"
     section rather than duplicating it, and add the one piece of advice currently
     only in `docs/music-server-mode-plan.md` §5: create a **dedicated Navidrome
     user** for the game, since the credential lives in `localStorage`, not the
     keychain.
   - **First run and controls.** What the 180×420 window looks like; the lane table
     (D F J K); **one** consolidated line on Space (pause/resume in My Library;
     autoplay↔manual under Spotify) replacing the three scattered explanations;
     `Ctrl+Shift+D` diagnostics; and **calibration** — Settings → `OffsetCalibrator`,
     writing `playbackTimingOffsetMs`, with a note that Spotify mode needs far more
     of it and that `outputLatency` differs between WebView2 and WKWebView
     (`audioContext.ts:56-71`), so a Mac-tuned default will feel off on Windows.
   - **Troubleshooting** table: SmartScreen; `link.exe`/linker not found → C++
     workload missing; Spotify 403 → dev-mode, use your own Client ID; "Could not
     bind 127.0.0.1:8888" → port taken (Jupyter/proxies are common on Windows) or
     an aborted login retried too fast, since Rust does not set `SO_REUSEADDR` on
     Windows, so wait a few seconds; Spotify login failing only on a managed laptop
     → `rustls` ships Mozilla roots and ignores the Windows cert store, so a
     corporate MITM proxy's root is not trusted; stale `dist/` → re-run
     `pnpm setup`; nothing plays → no active Spotify device, press play in Spotify
     first.
3. Everything currently in the file, in its current order, from "What it does" on.

**To keep the file from ballooning past its current 470 lines, cut and fold:**

- Demote "How to demo it (fast path)" (`README.md:144-200`) into the developer
  section as "Browser demo (no accounts)", with the `__mockPoller` snippet inside a
  `<details>` block.
- Fold "Full development setup" (`:203-220`) and "Running the app" (`:223-253`)
  into one **Development** section; player prerequisites are stated above, so this
  only adds `pnpm dev:ui`, `pnpm test`, `pnpm type-check`, and
  `cd apps/desktop/src-tauri && cargo check`.
- Drop the five individual `pnpm --filter @spotifyhero/<pkg> build` lines
  (`:164-168`) — `pnpm setup` replaces them.

### Factual corrections to make while in the file

| Where | Says | Should say |
|---|---|---|
| `:358-365` hit windows | 22 / 45 / 90 / 135 ms | **40 / 60 / 80 / 110** (`DEFAULT_HIT_WINDOWS`, `gameplay-core/src/index.ts:19-25`); expert is **88 / 108 / 138 / 188** (`useGameLoop.ts:64-69`). `docs/gameplay-spec.md`'s 38/58/105/150 is also wrong. |
| `:397` settings path | `~/.local/share/spotifyHero/settings.json` (Linux only) | Windows `%APPDATA%\io.spotifyhero.app\settings.json`, plus macOS and Linux equivalents |
| `:76-77` repo tree | lists `services/leaderboard/` | `services/` does not exist on disk — remove it, and **add the missing `apps/spotifyhero-web`** |
| `:78-83` docs list | omits three docs | add `music-server-mode-progress.md`, `highway-visual-overhaul-progress.md`, `sustain-visual-troubleshooting.md` (and this file) |
| `:239` window controls | claims a **maximize** button | only minimize + close are rendered (`WindowChrome.tsx:122-141`); `lib.rs:40` sets `.maximizable(false)` |
| `:414` config table | `spotify_client_id` among camelCase keys | both names are real — `spotifyClientId` is the Zod/localStorage key, `spotify_client_id` the mirrored Tauri store key. Say which is which. |
| Configuration table | no Supabase env vars | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are read at `gameStore.ts:30-31` but documented nowhere |
| `overlay-ui/package.json:5` | description says PixiJS | renderer is Canvas 2D |
| `docs/integration-spec.md:11` | tokens "encrypted on macOS via Keychain" | **false** — `tokens.rs:41-53` writes plaintext JSON via `tauri-plugin-store` on every OS, i.e. plaintext under `%APPDATA%\io.spotifyhero.app\settings.json` on Windows |

Update `scripts/README.md` for `scripts/setup/setup.js`, and update `CLAUDE.md`:
the new `pnpm setup` / `pnpm play` scripts, the CI workflow, and the fact that
`beforeDevCommand` now builds packages — so the "run `pnpm build` before
`pnpm dev:ui` on a fresh clone" gotcha at `CLAUDE.md:22` applies only to `dev:ui`,
not `dev:desktop`.

---

## 6. Deliberately out of scope

Report these but do not fix — pre-existing, unrelated to Windows onboarding, each
deserving its own change:

- Unused `tray-icon` Cargo feature (`Cargo.toml:16`) and
  `tauri-plugin-global-shortcut` (`Cargo.toml:18`, registered `lib.rs:19`) with no
  granted capability and no caller.
- `tauri-plugin-shell` is a dependency with `shell:default` granted but no frontend
  `shell.open` caller.
- `strip = true` (`Cargo.toml:34`) is a no-op under MSVC (symbols go to the PDB).
- `crate-type = ["staticlib", "cdylib", "rlib"]` (`Cargo.toml:10`) emits an extra
  `.dll`/`.lib` per build on MSVC. Harmless, just slower.
- `docs/architecture.md` / `docs/ai-agent-guide.md` still say PixiJS.
- Per-mode hit windows (`TODO(hit-windows)`) and keychain storage
  (`TODO(keychain)`).

---

## 7. Verification

**On macOS, before pushing — proves the build-order fix:**

```bash
pnpm type-check && pnpm test

# The real test: a pristine copy, exactly as a zip-downloading player sees it
cd /tmp && rm -rf sh-fresh
git clone --depth 1 <path-to-this-repo> sh-fresh && cd sh-fresh
pnpm setup          # must succeed with no packages/*/dist present beforehand
pnpm build:desktop  # must produce a bundle without a prior `pnpm build`
```

Confirm `packages/*/dist` did not exist before `pnpm setup`, and that
`apps/spotifyhero-web/node_modules` was **not** populated (no ffmpeg download).
Then confirm macOS artifacts still land where `itch-push.js` expects, so
`pnpm itch:release` is not regressed:

```bash
ls apps/desktop/src-tauri/target/release/bundle/macos/spotifyHero.app
ITCH_DRY_RUN=1 pnpm itch:push
cd apps/desktop/src-tauri && cargo check   # after the lib.rs:59 change
```

**Only CI on `windows-latest` can prove** the NSIS build, that dropping WiX removed
the .NET 3.5 dependency, and that `pnpm setup && pnpm build:desktop` works on
Windows. Push the branch, read the workflow run, download the artifact.

**Needs a real Windows machine — list as known-unverified, do not claim as done:**

- **Mouse-resize of the undecorated window.** `lib.rs:35` sets `.decorations(false)`
  and there is **no `startResizeDragging` call anywhere in `apps/overlay-ui/src`**.
  On Windows an undecorated tao window can lose native resize borders, Aero Snap
  and the drop shadow, which would make `lib.rs:31-33`'s
  `min_inner_size`/`max_inner_size` and the README's "Resize it (minimum 180×280)"
  unreachable by mouse. If broken, the fix is a CSS resize grip in
  `WindowChrome.tsx` calling `startResizeDragging` — a follow-up, not part of this
  change. **Do not promise resizing in the README until this is checked.**
- `outputLatency` non-zero on WebView2, which sets the calibration baseline
  (already on `docs/music-server-mode-progress.md:351`'s list).
- Whether `<a target="_blank">` links in `IdleScreen.tsx:219-221` /
  `SettingsPanel.tsx:235-238` open the OS browser on WebView2.
- `WindowChrome.tsx:22-32` casts `Monitor` to reach `workArea`; on Windows that is
  what excludes the taskbar, and the cast removes any type-level guarantee.

---

## 8. As built

Implemented 2026-09-28. Everything in §1–§5 landed; §6 was left alone as intended.
Five deviations, one of them a blocker the plan did not know about:

1. **`pnpm run setup`, never `pnpm setup`.** `pnpm setup` is a *built-in pnpm command*
   (it sets up pnpm's own home directory), and built-ins win over package scripts, so
   the plan's promised invocation would never have reached the script. The README,
   CI and `scripts/README.md` all say `pnpm run setup`, and say why.
2. **`verifyDepsBeforeRun: false` in `pnpm-workspace.yaml` — new, and required.** pnpm
   12 installs the *entire* workspace before running any `pnpm run <script>`. That
   silently re-added `apps/spotifyhero-web` and its ~80 MB `ffmpeg-static` postinstall
   in front of `setup.js`'s filtered install, and — worse — inside
   `beforeBuildCommand`, putting Context §3 back into every Tauri build. Measured on a
   pristine copy: 390 MB of `node_modules` with the auto-install, 114 MB without.
   Cost of the setting: `pnpm test` and friends no longer self-heal a stale
   `node_modules`.
3. **No `packageManager` field at all** — the CI workflow names its pnpm version
   directly (`pnpm/action-setup@v4` with `version: 12`) instead. The field was added
   first, as §1 asks, and pinning the plan's `pnpm@9.15.9` would have downgraded the
   dev machine (pnpm self-manages from that field), so it went in as `pnpm@12.6.0`.
   That turned out to be worse than no field:
   - pnpm 12 then records *itself* in `pnpm-lock.yaml` — a whole second YAML document,
     `packageManagerDependencies` plus ~30 `@pnpm/exe.<platform>` entries, +158 lines.
   - pnpm 9 cannot read a two-document lockfile. Measured against the real file:
     `WARN Ignoring broken lockfile … expected a single document in the stream, but
     found more`, then a full re-resolve from the registry. Silent loss of
     reproducibility for exactly the player the README promises to support (`pnpm >= 9`).
   - pnpm 10 does try to switch to the pinned version, and here it failed outright:
     `Failed to switch pnpm to v12.6.0 … spawnSync … ENOEXEC`.

   Without the field, the committed single-document lockfile is read by pnpm 9 through
   12 alike, which is what `engines.pnpm: ">=9.0.0"` claims. The field buys nothing a
   CI input does not.
4. **The Tauri hooks need `pnpm -w run build:packages`, not `pnpm run …`.** Tauri runs
   `beforeDevCommand`/`beforeBuildCommand` from `apps/desktop`, whose `package.json` has
   no such script, so the plan's exact text fails with `ERR_PNPM_NO_SCRIPT`. `-w` sends
   it to the workspace root.
5. **`services/*` removed from `pnpm-workspace.yaml`** while correcting the same
   phantom directory in the README tree.
6. **Resizing is not promised anywhere.** The README's window-controls text lists
   minimize and close only, and the troubleshooting table carries mouse-resize as
   *known-unverified on Windows* rather than as a feature.

### Verified here (macOS)

- `pnpm type-check` and `pnpm test` clean (398 tests).
- `cargo check` clean after the `lib.rs` `unwrap_or(true)` change.
- **The build-order fix, on a pristine copy** (`git ls-files -co` rsynced to `/tmp`, no
  `dist/` and no `node_modules` anywhere): `pnpm run setup` succeeds, builds all eight
  packages in topological order, and leaves `apps/spotifyhero-web/node_modules` absent.
- `pnpm build:desktop` end to end with the new `beforeBuildCommand`: packages → Vite →
  release binary → `spotifyHero.app` + `spotifyHero_0.0.1_aarch64.dmg`, i.e. the explicit
  `bundle.targets` list still produces what `itch-push.js` looks for, and
  `ITCH_DRY_RUN=1 pnpm itch:push` still resolves the `.app` and the `osx` channel.

Pre-existing and untouched: root `pnpm lint` fails, because `apps/spotifyhero-web` has no
ESLint config and `next lint` therefore prompts interactively. `pnpm type-check` is the
whole-repo check that works (and passes); every `packages/*` lint passes on its own.

### Still unverified — do not claim otherwise

- Everything in §7's Windows list, mouse-resize of the undecorated window above all.
- ~~The CI workflow itself.~~ Ran on `8718821` and passed: NSIS-only bundling and the
  dropped WiX/.NET 3.5 dependency are confirmed on `windows-latest`. But a green build only
  shows the installer is *produced* — `embedBootstrapper` earns its keep at install time on a
  machine without WebView2, which CI does not exercise.
- `pnpm itch:release` is untouched by design (the macOS `app`/`dmg` targets are still in
  the explicit `bundle.targets` list), but was not re-run end to end.
