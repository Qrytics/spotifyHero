import React from "react";
import { countChartTapsAndHolds } from "@spotifyhero/gameplay-core";
import { useGameStore } from "../store/gameStore.js";

export function ResultsScreen(): React.ReactElement {
  const session = useGameStore((s) => s.session);
  const resetRound = useGameStore((s) => s.resetRound);
  const playback = useGameStore((s) => s.playback);
  const chart = useGameStore((s) => s.chart);

  if (!session) return <></>;

  const pct = Math.round(session.accuracy * 100);
  const kinds = chart ? countChartTapsAndHolds(chart) : null;
  const trackName = playback?.track?.name ?? "Unknown";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "16px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{trackName}</div>
      <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--text)" }}>
        {session.score.toLocaleString()}
      </div>
      <div style={{ fontSize: "11px", color: "var(--accent)" }}>
        {pct}% accuracy · ×{session.maxCombo} max combo
      </div>
      {kinds !== null && (
        <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {kinds.taps} tap notes · {kinds.holds} sustain notes
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 12px",
          marginTop: "4px",
          fontSize: "10px",
          color: "var(--text-muted)",
        }}
      >
        {(["perfect", "great", "good", "bad", "miss"] as const).map((j) => (
          <React.Fragment key={j}>
            <span style={{ textAlign: "right", textTransform: "capitalize" }}>{j}</span>
            <span style={{ textAlign: "left", color: "var(--text)" }}>
              {session.judgements[j] ?? 0}
            </span>
          </React.Fragment>
        ))}
      </div>

      <button
        onClick={resetRound}
        style={{
          marginTop: "12px",
          background: "var(--accent)",
          color: "#000",
          border: "none",
          borderRadius: "var(--radius)",
          padding: "6px 18px",
          fontSize: "11px",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Back
      </button>
    </div>
  );
}
