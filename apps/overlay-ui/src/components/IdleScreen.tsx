import React, { useCallback, useEffect, useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { invoke } from "@tauri-apps/api/core";

type ConnectionStatus = { connected: boolean };

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function IdleScreen(): React.ReactElement {
  const settings = useGameStore((s) => s.settings);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tauri = isTauri();

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
      </div>

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
              {busy ? "Opening browser…" : "Connect Spotify"}
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
