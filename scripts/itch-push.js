/**
 * Upload the Windows NSIS build to itch.io using butler.
 * https://itch.io/docs/butler/
 *
 * Prerequisites: butler on PATH (or set BUTLER_PATH / ITCH_BUTLER to butler.exe), `butler login` once.
 * Config: env ITCH_USER + ITCH_GAME, or scripts/itch.env (see itch.env.example).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const tauriConfPath = path.join(root, "apps/desktop/src-tauri/tauri.conf.json");
const bundleDir = path.join(
  root,
  "apps/desktop/src-tauri/target/release/bundle/nsis"
);

/** Values in scripts/itch.env override inherited env (e.g. IDE shells with ITCH_USER=test). */
function loadLocalEnv() {
  const envPath = path.join(__dirname, "itch.env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  let setDry = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key === "ITCH_DRY_RUN") setDry = true;
    process.env[key] = val;
  }
  if (!setDry) delete process.env.ITCH_DRY_RUN;
}

function findInstaller() {
  if (!fs.existsSync(bundleDir)) {
    throw new Error(
      `Missing NSIS bundle folder:\n  ${bundleDir}\nRun: pnpm build:desktop`
    );
  }
  const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  const product = conf.productName || "spotifyHero";
  const files = fs.readdirSync(bundleDir).filter((f) => f.endsWith(".exe"));
  if (files.length === 0) {
    throw new Error(`No .exe in ${bundleDir}\nRun: pnpm build:desktop`);
  }
  const setup =
    files.find((f) => /setup/i.test(f)) ||
    files.find((f) => f.includes(product)) ||
    files[0];
  return { exePath: path.join(bundleDir, setup), version: conf.version };
}

function resolveButler() {
  const fromEnv = process.env.BUTLER_PATH || process.env.ITCH_BUTLER;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, ["butler"], { stdio: "pipe" });
    return "butler";
  } catch {
    /* fall through */
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    const chosenPath = path.join(
      process.env.APPDATA,
      "itch",
      "broth",
      "butler",
      ".chosen-version"
    );
    if (fs.existsSync(chosenPath)) {
      const ver = fs.readFileSync(chosenPath, "utf8").trim();
      const exePath = path.join(
        process.env.APPDATA,
        "itch",
        "broth",
        "butler",
        "versions",
        ver,
        "butler.exe"
      );
      if (fs.existsSync(exePath)) return exePath;
    }
  }

  throw new Error(
    "butler not found (PATH or itch app bundle). Install: https://itch.io/docs/butler/installing.html"
  );
}

function main() {
  loadLocalEnv();

  const user = process.env.ITCH_USER;
  const game = process.env.ITCH_GAME;
  const channel = process.env.ITCH_CHANNEL || "windows";
  const dry = process.env.ITCH_DRY_RUN === "1" || process.env.ITCH_DRY_RUN === "true";

  if (!user || !game) {
    throw new Error(
      "Set ITCH_USER (your itch username) and ITCH_GAME (game URL slug).\n" +
        "Example: copy scripts/itch.env.example to scripts/itch.env and edit.\n" +
        "Or: $env:ITCH_USER='me'; $env:ITCH_GAME='spotifyhero'"
    );
  }

  const { exePath, version } = findInstaller();
  const target = `${user}/${game}:${channel}`;

  const args = ["push", exePath, target, "--userversion", version];

  console.log(`Pushing ${path.basename(exePath)} → ${target} (v${version})`);

  if (dry) {
    console.log("[dry-run] butler " + args.join(" "));
    return;
  }

  const butler = resolveButler();
  execFileSync(butler, args, { stdio: "inherit", cwd: root });
  console.log("Done. Set the uploaded file as “Windows” executable on itch if prompted.");
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
