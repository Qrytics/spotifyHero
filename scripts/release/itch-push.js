/**
 * Upload the desktop build to itch.io using butler.
 * https://itch.io/docs/butler/
 *
 * Prerequisites: butler on PATH (or set BUTLER_PATH / ITCH_BUTLER to the binary), `butler login` once.
 * Config: env ITCH_USER + ITCH_GAME, or scripts/release/itch.env (see itch.env.example).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "../..");
const tauriConfPath = path.join(root, "apps/desktop/src-tauri/tauri.conf.json");
const bundleRoot = path.join(
  root,
  "apps/desktop/src-tauri/target/release/bundle"
);

/** Values in scripts/release/itch.env override inherited env (e.g. IDE shells with ITCH_USER=test). */
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

/**
 * Prefer the `.app` directory over the `.dmg`. butler uploads a directory
 * natively and preserves the executable bit, and a build pushed that way is one
 * the itch desktop app can install and launch on its own — a `.dmg` it can only
 * hand to the user to mount. Either way the browser download is a zip that itch
 * generates, so nothing is lost by not shipping the disk image.
 */
function findMacArtifact(product) {
  const appPath = path.join(bundleRoot, "macos", `${product}.app`);
  if (fs.existsSync(appPath)) {
    return { artifactPath: appPath, channel: "osx" };
  }

  const dmgDir = path.join(bundleRoot, "dmg");
  const dmgs = fs.existsSync(dmgDir)
    ? fs.readdirSync(dmgDir).filter((f) => f.endsWith(".dmg"))
    : [];
  if (dmgs[0]) {
    return { artifactPath: path.join(dmgDir, dmgs[0]), channel: "osx" };
  }

  throw new Error(
    `No ${product}.app in ${path.join(bundleRoot, "macos")} and no .dmg in ${dmgDir}\n` +
      "Run: pnpm build:desktop"
  );
}

function findWindowsArtifact(product) {
  const nsisDir = path.join(bundleRoot, "nsis");
  if (!fs.existsSync(nsisDir)) {
    throw new Error(
      `Missing NSIS bundle folder:\n  ${nsisDir}\nRun: pnpm build:desktop`
    );
  }
  const files = fs.readdirSync(nsisDir).filter((f) => f.endsWith(".exe"));
  if (files.length === 0) {
    throw new Error(`No .exe in ${nsisDir}\nRun: pnpm build:desktop`);
  }
  const setup =
    files.find((f) => /setup/i.test(f)) ||
    files.find((f) => f.includes(product)) ||
    files[0];
  return { artifactPath: path.join(nsisDir, setup), channel: "windows" };
}

/**
 * Tauri's `targets: "all"` only ever produces artifacts for the machine doing the
 * building, so the host platform — not a flag — decides what there is to find.
 * The channel name is what tells itch which platform the upload is for: butler
 * infers it from the substring (`osx`, `windows`, `linux`), so overriding
 * ITCH_CHANNEL with an unrelated name will leave the upload unplayable.
 */
function findArtifact() {
  const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  const product = conf.productName || "spotifyHero";

  let found;
  if (process.platform === "darwin") {
    found = findMacArtifact(product);
  } else if (process.platform === "win32") {
    found = findWindowsArtifact(product);
  } else {
    throw new Error(
      `No bundle layout known for platform "${process.platform}".\n` +
        "Only macOS and Windows hosts are wired up; add a branch to findArtifact()."
    );
  }

  return { ...found, version: conf.version };
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
  const dry = process.env.ITCH_DRY_RUN === "1" || process.env.ITCH_DRY_RUN === "true";

  if (!user || !game) {
    throw new Error(
      "Set ITCH_USER (your itch username) and ITCH_GAME (game URL slug).\n" +
        "Example: copy scripts/release/itch.env.example to scripts/release/itch.env and edit.\n" +
        "Or: ITCH_USER=me ITCH_GAME=spotifyhero pnpm itch:push"
    );
  }

  const { artifactPath, channel: defaultChannel, version } = findArtifact();
  const channel = process.env.ITCH_CHANNEL || defaultChannel;
  const target = `${user}/${game}:${channel}`;

  const args = ["push", artifactPath, target, "--userversion", version];

  console.log(`Pushing ${path.basename(artifactPath)} → ${target} (v${version})`);

  if (dry) {
    console.log("[dry-run] butler " + args.join(" "));
    return;
  }

  const butler = resolveButler();
  execFileSync(butler, args, { stdio: "inherit", cwd: root });

  console.log("Done.");
  if (process.platform === "darwin") {
    console.log(
      "The .app is unsigned and not notarised, so Gatekeeper will refuse it on first\n" +
        "launch after a browser download. Tell players to right-click → Open, or ship\n" +
        "through the itch app, which strips the quarantine flag itself."
    );
  }
}

try {
  main();
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
