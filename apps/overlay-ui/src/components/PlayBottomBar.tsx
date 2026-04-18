import React from "react";
import { useGameStore } from "../store/gameStore.js";
import { formatKeybindLabel } from "../lib/keybindDisplay.js";

type PlayBottomBarProps = {
  onOpenSettings: () => void;
  onOpenLeaderboard: () => void;
  leaderboardDisabled?: boolean;
};

/**
 * Bottom status strip — single horizontal row (no wrap) so narrow overlay windows stay readable.
 */
export function PlayBottomBar({
  onOpenSettings,
  onOpenLeaderboard,
  leaderboardDisabled = false,
}: PlayBottomBarProps): React.ReactElement {
  const phase = useGameStore((s) => s.phase);
  const lastEvent = useGameStore((s) => s.lastScoreEvent);
  const settings = useGameStore((s) => s.settings);

  const laneLabels = settings.laneKeys.map((k) => {
    const raw = k.trim();
    return raw.length === 0 ? "?" : raw.toLowerCase();
  });
  const lanesTitle = settings.laneKeys.map((k) => formatKeybindLabel(k)).join(" · ");

  const modeLabel =
    phase === "autoplay"
      ? "AUTO"
      : phase === "manual"
        ? "MANUAL"
        : phase === "paused"
          ? "PAUSED"
          : "";

  const modeColor =
    phase === "manual"
      ? "#1db954"
      : phase === "paused"
        ? "#ff9800"
        : "#889";

  const judgementStyle = (j: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      fontSize: "8px",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.02em",
      whiteSpace: "nowrap",
    };
    switch (j) {
      case "perfect":
        return { ...base, color: "#f5fff9" };
      case "great":
        return { ...base, color: "#1db954" };
      case "good":
        return { ...base, color: "#ffb74d" };
      case "bad":
        return { ...base, color: "#ff6e8b" };
      case "miss":
        return { ...base, color: "#ff5252" };
      default:
        return { ...base, color: "var(--text)" };
    }
  };

  return (
    <div
      className="play-bottom-bar"
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        alignItems: "center",
        gap: "6px",
        padding: "4px 6px",
        background: "#06060c",
        borderTop: "1px solid rgba(74,74,92,0.85)",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      {modeLabel ? (
        <span
          style={{
            fontSize: "8px",
            fontWeight: 700,
            color: modeColor,
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            flex: "0 0 auto",
          }}
        >
          {modeLabel}
        </span>
      ) : null}

      <div
        title={lanesTitle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "3px",
          whiteSpace: "nowrap",
          flex: "0 0 auto",
        }}
      >
        {laneLabels.map((lane, idx) => (
          <span
            key={`${lane}-${idx}`}
            style={{
              fontSize: "8px",
              fontWeight: 700,
              color: "rgba(255,255,255,0.9)",
              letterSpacing: "0.01em",
            }}
          >
            {lane}
          </span>
        ))}
      </div>

      {lastEvent ? (
        <span style={{ ...judgementStyle(lastEvent.judgement), flex: "0 0 auto" }}>
          {lastEvent.judgement}
        </span>
      ) : (
        <span
          style={{
            fontSize: "8px",
            fontWeight: 600,
            color: "#444",
            flex: "0 0 auto",
          }}
        >
          —
        </span>
      )}

      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "4px",
          minWidth: 0,
          flex: "1 1 auto",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={onOpenLeaderboard}
          title="Leaderboard"
          disabled={leaderboardDisabled}
          className="play-bottom-settings-btn"
          style={{
            opacity: leaderboardDisabled ? 0.45 : 1,
            cursor: leaderboardDisabled ? "not-allowed" : "pointer",
          }}
        >
          👥
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          className="play-bottom-settings-btn"
        >
          ⚙
        </button>
      </div>
    </div>
  );
}
