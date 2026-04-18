import React, { useCallback, useEffect, useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { invoke } from "@tauri-apps/api/core";
import type { SpotifyPollDiagnostics } from "../lib/spotifyDiagnostics.js";

type ConnectionStatus = { connected: boolean };

/** Spotify returns 403 when the logged-in user is not allowlisted on a Dev-mode app dashboard. */
function spotifyDevMode403Hint(invokeError: string | null): string | null {
  if (!invokeError) return null;
  const lower = invokeError.toLowerCase();
  if (
    invokeError.includes("403") &&
    (lower.includes("developer.spotify.com") ||
      lower.includes("may not be registered") ||
      lower.includes("user management"))
  ) {
    return invokeError;
  }
  return null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function IdleScreen(): React.ReactElement {
  const settings = useGameStore((s) => s.settings);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [spotifyApi403, setSpotifyApi403] = useState<string | null>(null);
  const tauri = isTauri();

  useEffect(() => {
    if (!tauri) return;
    const onDiag = (ev: Event) => {
      const d = (ev as CustomEvent<SpotifyPollDiagnostics>).detail;
      if (!d?.invokeError) {
        setSpotifyApi403(null);
        return;
      }
      const hint = spotifyDevMode403Hint(d.invokeError);
      setSpotifyApi403(hint);
    };
    window.addEventListener("spotifyhero-diagnostics", onDiag);
    return () => window.removeEventListener("spotifyhero-diagnostics", onDiag);
  }, [tauri]);

  const refreshStatus = useCallback(async () => {
    if (!tauri) return;
    try {
      const s = await invoke<ConnectionStatus>("spotify_connection_status");
      setConnected(s.connected);
      setErr(null);
    } catch {
      setConnected(false);
    }
  }, [tauri]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!tauri) return;
    const id = window.setInterval(() => void refreshStatus(), 4000);
    return () => window.clearInterval(id);
  }, [tauri, refreshStatus]);

  const onConnect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await invoke("spotify_login");
      await refreshStatus();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await invoke("spotify_logout");
      await refreshStatus();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        padding: "16px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "28px" }}>🎵</div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--accent)" }}>
        spotifyHero
      </div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.5 }}>
        {tauri ? (
          <>
            {connected
              ? "Spotify linked — start playback in Spotify (Premium recommended)."
              : "Connect your Spotify account, then press play in the Spotify app."}
            <br />
            Closed the Spotify login tab? Click <strong>Connect Spotify</strong> again to
            reopen it.
            <br />
            Requires an active Spotify session (Web API). Premium needed for full
            currently-playing data.
          </>
        ) : (
          <>
            Browser demo: open the console and run{" "}
            <code style={{ fontSize: "9px", color: "var(--accent)" }}>
              window.__mockPoller?.simulatePlay(...)
            </code>{" "}
            (see README).
          </>
        )}
        <br />
        Press{" "}
        <kbd style={{ background: "#222", padding: "1px 4px", borderRadius: "3px" }}>
          {settings.playKeybind}
        </kbd>{" "}
        to toggle manual play.
        <br />
        <span style={{ opacity: 0.75 }}>
          Stuck? Press{" "}
          <kbd style={{ background: "#222", padding: "1px 4px", borderRadius: "3px" }}>
            Ctrl+Shift+D
          </kbd>{" "}
          for Spotify debug (copy JSON for support).
        </span>
      </div>

      {tauri && spotifyApi403 && (
        <div
          style={{
            maxWidth: "300px",
            marginTop: "4px",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid rgba(220, 160, 60, 0.55)",
            background: "rgba(60, 45, 20, 0.45)",
            fontSize: "10px",
            lineHeight: 1.5,
            color: "#e8d4b0",
            textAlign: "left",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: "6px", color: "#ffb84d" }}>
            Spotify API blocked (403)
          </div>
          <p style={{ margin: "0 0 8px 0" }}>
            Your app is probably in{" "}
            <strong style={{ color: "#fff" }}>Development mode</strong> on the Spotify
            Developer Dashboard. Add the <strong style={{ color: "#fff" }}>same email</strong>{" "}
            you use for Spotify under{" "}
            <strong style={{ color: "#fff" }}>Dashboard → your app → Settings → User Management</strong>
            , then use <strong style={{ color: "#fff" }}>Disconnect</strong> and connect again
            here.
          </p>
          <a
            href="https://developer.spotify.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#8cf", fontWeight: 600 }}
          >
            Open Spotify Developer Dashboard
          </a>
        </div>
      )}

      {tauri && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
          {!connected ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onConnect()}
              style={{
                padding: "8px 14px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "6px",
                border: "none",
                cursor: busy ? "wait" : "pointer",
                background: "var(--accent)",
                color: "#0d0d0f",
              }}
            >
              {busy ? "Starting…" : "Connect Spotify"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDisconnect()}
              style={{
                padding: "6px 12px",
                fontSize: "10px",
                borderRadius: "6px",
                border: "1px solid #333",
                cursor: busy ? "wait" : "pointer",
                background: "transparent",
                color: "var(--text-muted)",
              }}
            >
              {busy ? "…" : "Disconnect Spotify"}
            </button>
          )}
        </div>
      )}

      {err && (
        <div style={{ fontSize: "10px", color: "#f66", maxWidth: "280px" }}>{err}</div>
      )}
    </div>
  );
}
