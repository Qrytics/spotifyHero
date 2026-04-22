import React, { useState } from "react";
import { countChartTapsAndHolds } from "@spotifyhero/gameplay-core";
import { useGameStore } from "../store/gameStore.js";
import { LeaderboardPanel } from "./LeaderboardPanel.js";

export function ResultsScreen(): React.ReactElement {
  const session = useGameStore((s) => s.session);
  const resetRound = useGameStore((s) => s.resetRound);
  const playback = useGameStore((s) => s.playback);
  const chart = useGameStore((s) => s.chart);
  const usedAutoplayThisRound = useGameStore((s) => s.usedAutoplayThisRound);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  if (!session) return <></>;

  const pct = Math.round(session.accuracy * 100);
  const kinds = chart ? countChartTapsAndHolds(chart) : null;
  const trackName = playback?.track?.name ?? "Unknown";
  const albumArt = playback?.track?.albumArt;

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
      {albumArt ? (
        <img
          src={albumArt}
          alt={`${trackName} album cover`}
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid rgba(255,255,255,0.15)",
            marginBottom: "2px",
            background: "rgba(255,255,255,0.06)",
          }}
        />
      ) : (
        <div
          aria-label="Album cover unavailable"
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.15)",
            marginBottom: "2px",
            background: "rgba(255,255,255,0.06)",
          }}
        />
      )}
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
      <button
        onClick={() => setLeaderboardOpen(true)}
        style={{
          marginTop: "2px",
          background: "transparent",
          color: "var(--accent)",
          border: "1px solid #2c5",
          borderRadius: "var(--radius)",
          padding: "5px 12px",
          fontSize: "10px",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Leaderboard
      </button>
      <LeaderboardPanel
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        trackId={session.trackId}
        difficulty={session.difficulty}
        session={session}
        eligibleForRanking={!usedAutoplayThisRound}
      />
    </div>
  );
}
