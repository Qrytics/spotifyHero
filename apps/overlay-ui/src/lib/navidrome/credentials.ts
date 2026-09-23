/**
 * Navidrome / Subsonic credential persistence.
 *
 * Deliberately **not** part of `AppSettingsSchema`: that schema is re-parsed on
 * every `updateSettings`, is partly mirrored into Tauri's `settings.json`, and
 * is the obvious thing to dump into a diagnostics panel. Credentials get their
 * own key and their own schema so they never ride along by accident.
 *
 * SECURITY (deliberate v1 compromise — do not read this as a safety measure):
 * `token = md5(password + salt)` with a fixed salt is a *password-equivalent
 * bearer credential*. Storing it instead of the plaintext password only avoids
 * the word "password" appearing in localStorage; an attacker with the blob has
 * full access to the music server account either way.
 *
 * This is no worse than the status quo — Spotify access/refresh tokens already
 * sit unencrypted in Tauri's `settings.json`.
 *
 * TODO(keychain): move this to the OS keychain behind a Tauri command
 * (`keyring` crate) and keep only `{serverUrl, username}` here.
 * Mitigation available today: create a dedicated Navidrome user for the game
 * so this credential is independently revocable.
 */
import { z } from "zod";
import { md5 } from "./md5.js";

const STORAGE_KEY = "spotifyHero_navidrome_v1";

export const NavidromeCredentialsSchema = z.object({
  /** Origin + optional base path, no trailing slash, no `/rest` suffix. */
  serverUrl: z.string().url(),
  username: z.string().min(1),
  salt: z.string().min(8),
  /** md5(password + salt) — 32 lowercase hex chars. */
  token: z.string().length(32),
});
export type NavidromeCredentials = z.infer<typeof NavidromeCredentialsSchema>;

/**
 * Strips a trailing slash and an accidentally-pasted `/rest` so users can paste
 * whatever the Navidrome web UI showed them.
 */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/rest$/i, "");
  // Navidrome's web UI lives at `/app`; users copy the address bar.
  url = url.replace(/\/app(\/#.*)?$/i, "");
  return url.replace(/\/+$/, "");
}

/** 16 random bytes as hex — one salt per login, then reused for every request. */
export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Derives the stored credential from a plaintext password. The password is used
 * exactly once, here, and is never persisted or returned.
 *
 * Throws a `ZodError` on a malformed server address, so the login form can
 * report that before any request is attempted.
 */
export function deriveCredentials(
  serverUrl: string,
  username: string,
  password: string
): NavidromeCredentials {
  const salt = generateSalt();
  return NavidromeCredentialsSchema.parse({
    serverUrl: normalizeServerUrl(serverUrl),
    username: username.trim(),
    salt,
    token: md5(password + salt),
  });
}

export function loadCredentials(): NavidromeCredentials | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = NavidromeCredentialsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: NavidromeCredentials): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // Non-fatal: the session keeps working, the user re-logs in next launch.
  }
}

export function clearCredentials(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
