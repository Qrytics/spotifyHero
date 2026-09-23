import { useCallback, useEffect, useRef, useState } from "react";
import {
  NavidromeClient,
  NavidromeError,
} from "../lib/navidrome/client.js";
import {
  clearCredentials,
  deriveCredentials,
  loadCredentials,
  saveCredentials,
  type NavidromeCredentials,
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
  login: (
    serverUrl: string,
    username: string,
    password: string
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
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const verify = useCallback(
    async (creds: NavidromeCredentials): Promise<boolean> => {
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
        if (authFailed) {
          clearCredentials();
          setStatus("logged-out");
        } else {
          setStatus("error");
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
    void verify(stored);
  }, [verify, attempt]);

  const login = useCallback(
    async (serverUrl: string, username: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        // The plaintext password is used exactly once, here, to derive the token.
        const creds = deriveCredentials(serverUrl, username, password);
        const ok = await verify(creds);
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
    setClient(null);
    setError(null);
    setStatus("logged-out");
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, client, error, busy, login, logout, retry };
}
