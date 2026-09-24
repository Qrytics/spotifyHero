import { useCallback, useEffect, useRef, useState } from "react";
import {
  NavidromeClient,
  NavidromeError,
} from "../lib/navidrome/client.js";
import {
  clearCredentials,
  clearLoginHintPassword,
  deriveCredentials,
  loadCredentials,
  loadLoginHint,
  saveCredentials,
  saveLoginHint,
  type NavidromeCredentials,
  type NavidromeLoginHint,
} from "../lib/navidrome/credentials.js";

export type NavidromeAuthStatus =
  | "checking"
  | "logged-out"
  | "logged-in"
  /** Stored credential exists but the server rejected or could not be reached. */
  | "error";

export type NavidromeAuth = {
  status: NavidromeAuthStatus;
  client: NavidromeClient | null;
  /** Server-reported failure, if any. */
  error: string | null;
  busy: boolean;
  /** Last successful login, for seeding the form. Survives an auth failure. */
  savedLogin: NavidromeLoginHint | null;
  login: (
    serverUrl: string,
    username: string,
    password: string,
    rememberPassword: boolean
  ) => Promise<boolean>;
  logout: () => void;
  /** Re-`ping` with the stored credential (after a transient network failure). */
  retry: () => void;
};

/**
 * Navidrome session state, deliberately **local React state and not in the game
 * store**: nothing outside the library UI needs it, and the store is persisted
 * and diagnostics-dumped.
 */
export function useNavidromeAuth(): NavidromeAuth {
  const [status, setStatus] = useState<NavidromeAuthStatus>("checking");
  const [client, setClient] = useState<NavidromeClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Seeded from storage on mount and updated on every login attempt. It has to
  // be state, not a plain `loadLoginHint()` read: the login form seeds its
  // fields from this once per mount, and it re-mounts whenever `status` leaves
  // "logged-out" and comes back — so a hint that only reached localStorage
  // would not be in the fields the user is looking at.
  const [savedLogin, setSavedLogin] = useState(loadLoginHint);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const verify = useCallback(
    async (
      creds: NavidromeCredentials,
      /**
       * True when `creds` came out of storage, so "Retry" has something to retry
       * with. False for a fresh form submission: there is nothing stored yet, so
       * a network failure must leave the user on the form (with the message
       * inline) rather than on a Retry screen that can only bounce back.
       */
      restorable: boolean
    ): Promise<boolean> => {
      const c = new NavidromeClient(creds);
      try {
        await c.ping();
        if (!mountedRef.current) return true;
        setClient(c);
        setError(null);
        setStatus("logged-in");
        return true;
      } catch (e) {
        if (!mountedRef.current) return false;
        const authFailed = e instanceof NavidromeError && e.kind === "auth";
        setClient(null);
        setError(e instanceof Error ? e.message : String(e));
        // A wrong credential is unrecoverable — drop it and show the form again.
        // A network failure is not: keep it so "Retry" can work offline→online.
        // The login *hint* is untouched either way, so the form comes back with
        // the server and username (and password, if remembered) still filled in.
        if (authFailed) {
          clearCredentials();
          setStatus("logged-out");
        } else {
          setStatus(restorable ? "error" : "logged-out");
        }
        return false;
      }
    },
    []
  );

  // Restore a stored session on mount (and on explicit retry).
  useEffect(() => {
    const stored = loadCredentials();
    if (!stored) {
      setStatus("logged-out");
      return;
    }
    setStatus("checking");
    void verify(stored, true);
  }, [verify, attempt]);

  const login = useCallback(
    async (
      serverUrl: string,
      username: string,
      password: string,
      rememberPassword: boolean
    ) => {
      setBusy(true);
      setError(null);
      // Remember what was typed *before* the attempt, not after it succeeds.
      // A failing attempt is exactly when the fields matter most, and it is also
      // when the form is most likely to be torn down (a wrong address is a
      // network failure, not an auth failure) — so saving only on success meant
      // the box was ticked and nothing came back. A password that turns out to
      // be wrong is worth keeping: the user is about to edit one character of it.
      const hint: NavidromeLoginHint = {
        serverUrl,
        username,
        rememberPassword,
        // `exactOptionalPropertyTypes`: omit the key, never set it undefined.
        ...(rememberPassword ? { password } : {}),
      };
      saveLoginHint(hint);
      setSavedLogin(hint);
      try {
        // The plaintext password is used once here to derive the token; the copy
        // in `hint` above exists only because the user asked for it.
        const creds = deriveCredentials(serverUrl, username, password);
        const ok = await verify(creds, false);
        if (ok) saveCredentials(creds);
        return ok;
      } catch {
        // `deriveCredentials` only throws on a malformed server address.
        setError("That server address does not look like a URL.");
        setStatus("logged-out");
        return false;
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [verify]
  );

  const logout = useCallback(() => {
    clearCredentials();
    // Signing out is a deliberate "forget me", so the password goes — but the
    // server address and username stay, so signing back in is one field.
    clearLoginHintPassword();
    // Keep the in-memory copy in step with storage, so the form that renders
    // next doesn't prefill a password we just threw away.
    setSavedLogin((prev) =>
      prev
        ? {
            serverUrl: prev.serverUrl,
            username: prev.username,
            rememberPassword: prev.rememberPassword,
          }
        : prev
    );
    setClient(null);
    setError(null);
    setStatus("logged-out");
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, client, error, busy, savedLogin, login, logout, retry };
}
