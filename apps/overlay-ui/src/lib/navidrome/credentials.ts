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
 * And with "Remember password" on, the login hint below stores the plaintext
 * password too, so it can be typed back into the form. Same blast radius, said
 * out loud: anyone who can read this origin's localStorage already had the
 * account via the token.
 *
 * This is no worse than the status quo — Spotify access/refresh tokens already
 * sit unencrypted in Tauri's `settings.json`.
 *
 * TODO(keychain): move **both records** to the OS keychain behind a Tauri
 * command (`keyring` crate) and keep only `{serverUrl, username}` here.
 * Mitigation available today: create a dedicated Navidrome user for the game
 * so this credential is independently revocable.
 */
import { z } from "zod";
import { md5 } from "./md5.js";

const STORAGE_KEY = "spotifyHero_navidrome_v1";
const LOGIN_HINT_KEY = "spotifyHero_navidrome_login_v1";

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

// ---------------------------------------------------------------------------
// Login hint — what the form types back in
// ---------------------------------------------------------------------------

/**
 * The last successful login, kept **separately from the credential above** so it
 * survives `clearCredentials()`. That is the whole point: a rejected password
 * drops the credential, and without this the user would have to retype the
 * server address and username to fix a one-character typo.
 */
export const NavidromeLoginHintSchema = z.object({
  /** As the user typed it, before `normalizeServerUrl` — it goes back in the field. */
  serverUrl: z.string().min(1),
  username: z.string().min(1),
  /** Present only while "Remember password" is on. See the SECURITY note above. */
  password: z.string().optional(),
  /**
   * The checkbox state, tracked separately from `password` because sign-out
   * strips the password but must not silently uncheck the box.
   */
  rememberPassword: z.boolean().default(true),
});
export type NavidromeLoginHint = z.infer<typeof NavidromeLoginHintSchema>;

export function loadLoginHint(): NavidromeLoginHint | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LOGIN_HINT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = NavidromeLoginHintSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveLoginHint(hint: NavidromeLoginHint): void {
  try {
    localStorage.setItem(LOGIN_HINT_KEY, JSON.stringify(hint));
  } catch {
    // Non-fatal: the session keeps working, the form is just empty next time.
  }
}

/**
 * Sign-out: forget the password, keep the server, username, and the checkbox
 * preference (so signing back in still offers to remember it).
 */
export function clearLoginHintPassword(): void {
  const hint = loadLoginHint();
  if (!hint) return;
  saveLoginHint({
    serverUrl: hint.serverUrl,
    username: hint.username,
    rememberPassword: hint.rememberPassword,
  });
}

export function clearLoginHint(): void {
  try {
    localStorage.removeItem(LOGIN_HINT_KEY);
  } catch {
    /* ignore */
  }
}
