/**
 * One-command setup for a fresh checkout (or an unzipped copy) of this repo.
 *
 *   pnpm run setup            install dependencies, then build every workspace package
 *   pnpm run build:packages   just rebuild packages/* (used by Tauri's build hooks)
 *
 * Why a Node script instead of a package.json one-liner: the pnpm filters below
 * (`--filter=!spotifyhero-web`, `--filter=./packages/**`) need quoting that differs
 * between cmd.exe, PowerShell and sh. Driving pnpm through execFileSync with an argv
 * array sidesteps quoting entirely, so the same command works on every OS.
 *
 * Note: `pnpm setup` (without `run`) is pnpm's own built-in command, not this script.
 */

const { execFileSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "../..");
const buildOnly = process.argv.slice(2).includes("--build-only");

const MIN_NODE_MAJOR = 20;
const MIN_PNPM_MAJOR = 9;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/**
 * How to invoke pnpm as a child process.
 *
 * When we were started by pnpm itself, `npm_execpath` points at pnpm's own JS entry
 * point — running that with this Node binary is exact and needs no PATH lookup.
 * Otherwise fall back to the PATH, which on Windows means `pnpm.cmd`, and Node
 * refuses to spawn a `.cmd` without a shell (CVE-2024-27980), so ask for one there.
 * Arguments still travel as an array, and none of them contain characters cmd.exe
 * treats specially.
 */
function resolvePnpm() {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.[cm]?js$/.test(execPath)) {
    return { cmd: process.execPath, prefix: [execPath], shell: false };
  }
  if (process.platform === "win32") {
    return { cmd: "pnpm.cmd", prefix: [], shell: true };
  }
  return { cmd: "pnpm", prefix: [], shell: false };
}

const pnpm = resolvePnpm();

function runPnpm(args, { optional = false } = {}) {
  console.log(`\n▸ pnpm ${args.join(" ")}`);
  try {
    execFileSync(pnpm.cmd, [...pnpm.prefix, ...args], {
      cwd: root,
      stdio: "inherit",
      shell: pnpm.shell,
    });
    return true;
  } catch (err) {
    if (optional) return false;
    fail(`\`pnpm ${args.join(" ")}\` failed.\n  ${err.message}`);
  }
}

function pnpmVersion() {
  try {
    return execFileSync(pnpm.cmd, [...pnpm.prefix, "--version"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      shell: pnpm.shell,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function hasCargo() {
  try {
    execFileSync("cargo", ["--version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. Prerequisites
// ---------------------------------------------------------------------------

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
  fail(
    `Node ${MIN_NODE_MAJOR} or newer is required (this is Node ${process.versions.node}).\n` +
      "  Install the LTS build from https://nodejs.org/en/download"
  );
}

const version = pnpmVersion();
if (!version) {
  fail(
    "pnpm was not found on PATH.\n" +
      "  Install it with:  npm i -g pnpm\n" +
      "  Then run again:   pnpm run setup"
  );
}
const pnpmMajor = Number(version.split(".")[0]);
if (!Number.isFinite(pnpmMajor) || pnpmMajor < MIN_PNPM_MAJOR) {
  fail(
    `pnpm ${MIN_PNPM_MAJOR} or newer is required (this is pnpm ${version}).\n` +
      "  Upgrade with:  npm i -g pnpm@latest"
  );
}

console.log(`spotifyHero setup — Node ${process.versions.node}, pnpm ${version}`);

// ---------------------------------------------------------------------------
// 2. Install dependencies
// ---------------------------------------------------------------------------

if (!buildOnly) {
  // apps/spotifyhero-web is an isolated Next.js edition that imports nothing from
  // @spotifyhero/*, and its postinstall downloads an ~80 MB ffmpeg binary. Skipping
  // it is only a speed and bandwidth win, so never let that optimisation fail setup:
  // a filtered install can trip pnpm's lockfile-freshness check.
  const filtered = runPnpm(["install", "--filter=!spotifyhero-web"], {
    optional: true,
  });
  if (!filtered) {
    console.log(
      "\n  Filtered install did not take; falling back to a full `pnpm install`."
    );
    runPnpm(["install"]);
  }
}

// ---------------------------------------------------------------------------
// 3. Build the workspace packages
// ---------------------------------------------------------------------------

// Every package is consumed through its gitignored dist/ (`main: ./dist/index.js`),
// so nothing — not Vite, not the Tauri build — can resolve @spotifyhero/* until this
// has run. pnpm derives the topological order from the workspace:* dependencies.
// Deliberately not `pnpm -r build`, which would also run `next build` in the web app.
runPnpm(["--filter=./packages/**", "build"]);

// ---------------------------------------------------------------------------
// 4. Report what is still missing for the native app
// ---------------------------------------------------------------------------

console.log("\n✔ Setup complete.");

if (!buildOnly) {
  if (hasCargo()) {
    console.log("  Next:  pnpm play            (native overlay window)");
  } else {
    console.log(
      "\n  Note: `cargo` was not found, so the native desktop app cannot build yet.\n" +
        "  For `pnpm play` / `pnpm build:desktop` you also need:\n" +
        "    • Rust           https://rustup.rs\n" +
        "    • Windows only:  Visual Studio Build Tools with the\n" +
        "                     “Desktop development with C++” workload\n" +
        "    • Linux only:    libwebkit2gtk-4.1-dev and build-essential\n" +
        "\n  The browser demo needs neither:  pnpm dev:ui"
    );
  }
  console.log("");
}
