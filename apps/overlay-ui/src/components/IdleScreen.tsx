import React, { useCallback, useEffect, useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { invoke } from "@tauri-apps/api/core";
import type { SpotifyPollDiagnostics } from "../lib/spotifyDiagnostics.js";
import { formatKeybindLabel } from "../lib/keybindDisplay.js";
import { GAME_LOGO_SRC, GAME_TITLE } from "../lib/branding.js";

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

type IdleProps = {
  onOpenSettings?: () => void;
};

export function IdleScreen({ onOpenSettings }: IdleProps): React.ReactElement {
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

  const laneHint = settings.laneKeys.map((k) => formatKeybindLabel(k)).join(" ");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        minHeight: 0,
        padding: "10px 12px 12px",
        textAlign: "center",
      }}
    >
      {/* Scrolls when the overlay window is short — keeps action buttons visible below */}
      <div
        className="idle-screen-scroll thin-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
          paddingBottom: "4px",
        }}
      >
        <img
          src={GAME_LOGO_SRC}
          alt={`${GAME_TITLE} logo`}
          style={{
            width: 58,
            height: 58,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        />
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--accent)" }}>
          {GAME_TITLE}
        </div>
        <div
          style={{
            fontSize: "9px",
            color: "var(--text-muted)",
            lineHeight: 1.45,
            maxWidth: "280px",
          }}
        >
          {tauri ? (
            connected ? (
              <>
                Linked — start music in Spotify.
                <br />
                Premium recommended for timing.
              </>
            ) : (
              <>
                Connect, then press play in Spotify.
                <br />
                Reopen login: tap Connect again.
              </>
            )
          ) : (
            <>
              Demo: console →{" "}
              <code style={{ fontSize: "8px", color: "var(--accent)" }}>
                window.__mockPoller?.simulatePlay(...)
              </code>
            </>
          )}
        </div>
        {tauri && (
          <div
            style={{
              fontSize: "8px",
              color: "rgba(255,255,255,0.45)",
              lineHeight: 1.35,
              maxWidth: "280px",
            }}
          >
            Lanes {laneHint} · optional {formatKeybindLabel(settings.playKeybind)} ·{" "}
            <kbd style={{ background: "#1a1a1f", padding: "0 3px", borderRadius: "3px" }}>
              Ctrl+Shift+D
            </kbd>{" "}
            debug
          </div>
        )}

        {tauri && spotifyApi403 && (
          <div
            style={{
              maxWidth: "280px",
              width: "100%",
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid rgba(220, 160, 60, 0.5)",
              background: "rgba(60, 45, 20, 0.4)",
              fontSize: "9px",
              lineHeight: 1.45,
              color: "#e8d4b0",
              textAlign: "left",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "4px", color: "#ffb84d" }}>
              Spotify API 403
            </div>
            <p style={{ margin: "0 0 6px 0" }}>
              The shared app is in Spotify &quot;development&quot; mode (max 5 allowlisted users).
              Either ask the developer to add your email under User Management, or open Settings and
              paste your own Spotify app Client ID (free; add redirect{" "}
              <code style={{ fontSize: "8px" }}>http://127.0.0.1:8888/callback</code>
              ), then Disconnect and Connect again.
            </p>
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#8cf", fontWeight: 600 }}
            >
              Dashboard
            </a>
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          alignItems: "center",
          paddingTop: "8px",
          borderTop: "1px solid rgba(60,60,70,0.5)",
        }}
      >
        {tauri && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center" }}>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                style={{
                  padding: "6px 12px",
                  fontSize: "10px",
                  borderRadius: "6px",
                  border: "1px solid #333",
                  cursor: "pointer",
                  background: "#222",
                  color: "var(--text)",
                }}
              >
                ⚙ Settings
              </button>
            )}
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
          <div style={{ fontSize: "9px", color: "#f66", maxWidth: "260px" }}>{err}</div>
        )}
      </div>
    </div>
  );
}
