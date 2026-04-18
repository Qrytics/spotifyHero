import React from "react";
import { useGameStore } from "../store/gameStore.js";

/**
 * HUD – the top bar showing score, combo, track name, and mode.
 */
export function HUD(): React.ReactElement {
  const score = useGameStore((s) => s.score);
  const combo = useGameStore((s) => s.combo);
  const phase = useGameStore((s) => s.phase);
  const playback = useGameStore((s) => s.playback);
  const lastEvent = useGameStore((s) => s.lastScoreEvent);

  const trackName = playback?.track?.name ?? "—";
  const artist = playback?.track?.artists.join(", ") ?? "";

  const judgementColor: Record<string, string> = {
    perfect: "#fff",
    great: "#1db954",
    good: "#ff9800",
    bad: "#ff4081",
    miss: "#e53935",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px 10px 4px",
        background: "var(--surface)",
        borderBottom: "1px solid #222",
        gap: "2px",
      }}
    >
      {/* Track info row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <div
          style={{
            flex: 1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: "var(--text)",
            }}
          >
            {trackName}
          </div>
          <div
            style={{
              fontSize: "9px",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {artist}
          </div>
        </div>
        <div
          style={{
            textAlign: "right",
            flexShrink: 0,
          }}
        >
          <div
            style={{ fontSize: "14px", fontWeight: 800, color: "var(--text)" }}
          >
            {score.toLocaleString()}
          </div>
          <div
            style={{
              fontSize: "9px",
              color: "var(--accent)",
              fontWeight: 600,
            }}
          >
            {combo > 1 ? `×${combo} COMBO` : ""}
          </div>
        </div>
      </div>

      {/* Mode + judgement flash row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontSize: "9px",
            color: phase === "autoplay" ? "var(--text-muted)" : "var(--accent)",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {phase === "autoplay" ? "Autoplay" : phase === "manual" ? "▶ Manual" : phase}
        </div>
        {lastEvent && (
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              color: judgementColor[lastEvent.judgement] ?? "var(--text)",
              textTransform: "uppercase",
            }}
          >
            {lastEvent.judgement}
          </div>
        )}
      </div>
    </div>
  );
}
