import React, { useCallback, useEffect, useState } from "react";
import type { SpotifyPollDiagnostics } from "../lib/spotifyDiagnostics.js";
import {
  diagnosticsToClipboardText,
  isSpotifyDebugPanelEnabled,
  SPOTIFY_DEBUG_STORAGE_KEY,
  truncateForDiagnostics,
} from "../lib/spotifyDiagnostics.js";

function readWindowDiag(): SpotifyPollDiagnostics | null {
  const w = window as Window & { __spotifyHeroDiagnostics?: SpotifyPollDiagnostics };
  return w.__spotifyHeroDiagnostics ?? null;
}

/**
 * Toggle with **Ctrl+Shift+D** or `localStorage.setItem('spotifyHero_debug','1')` + reload.
 * Shows last poll: IPC errors, Zod mismatch, parsed playing/track (or idle).
 */
export function SpotifyDiagnosticsPanel(): React.ReactElement | null {
  const [open, setOpen] = useState(isSpotifyDebugPanelEnabled);
  const [diag, setDiag] = useState<SpotifyPollDiagnostics | null>(() => readWindowDiag());

  useEffect(() => {
    const syncOpen = () => setOpen(isSpotifyDebugPanelEnabled());
    const onDiag = (ev: Event) => {
      const ce = ev as CustomEvent<SpotifyPollDiagnostics>;
      if (ce.detail) setDiag(ce.detail);
    };
    window.addEventListener("spotifyhero-debug-toggle", syncOpen);
    window.addEventListener("spotifyhero-diagnostics", onDiag);
    return () => {
      window.removeEventListener("spotifyhero-debug-toggle", syncOpen);
      window.removeEventListener("spotifyhero-diagnostics", onDiag);
    };
  }, []);

  const copy = useCallback(async () => {
    const d = readWindowDiag();
    if (!d) return;
    try {
      await navigator.clipboard.writeText(diagnosticsToClipboardText(d));
    } catch {
      /* ignore */
    }
  }, []);

  if (!open) return null;

  const rawView = diag?.raw != null ? truncateForDiagnostics(diag.raw, 6000) : null;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "42%",
        overflow: "auto",
        zIndex: 9999,
        background: "rgba(12,12,14,0.97)",
        borderTop: "1px solid #333",
        fontFamily: "ui-monospace, monospace",
        fontSize: "10px",
        lineHeight: 1.45,
        color: "#ddd",
        padding: "10px 12px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "#9f9", fontWeight: 700 }}>Spotify diagnostics</span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void copy()}
            style={{
              fontSize: "10px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: "#222",
              color: "#eee",
              cursor: "pointer",
            }}
          >
            Copy JSON
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(SPOTIFY_DEBUG_STORAGE_KEY, "0");
              } catch {
                /* ignore */
              }
              setOpen(false);
              window.dispatchEvent(new CustomEvent("spotifyhero-debug-toggle"));
            }}
            style={{
              fontSize: "10px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: "transparent",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>

      <div style={{ color: "#888", marginBottom: "6px" }}>
        Console:{" "}
        <code style={{ color: "#9cf" }}>copy(JSON.stringify(window.__spotifyHeroDiagnostics,null,2))</code>
      </div>

      {diag ? (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(
            {
              updatedAt: diag.updatedAt,
              invokeError: diag.invokeError,
              zodFlat: diag.zodFlat,
              parsed: diag.parsed,
              raw: rawView,
            },
            null,
            2
          )}
        </pre>
      ) : (
        <div style={{ color: "#888" }}>Waiting for first poll…</div>
      )}
    </div>
  );
}
