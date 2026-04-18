import React from "react";
import { useGameStore } from "../store/gameStore.js";
import { formatKeybindLabel } from "../lib/keybindDisplay.js";

type PlayBottomBarProps = {
  onOpenSettings: () => void;
};

/**
 * Bottom status strip — single horizontal row (no wrap) so narrow overlay windows stay readable.
 */
export function PlayBottomBar({ onOpenSettings }: PlayBottomBarProps): React.ReactElement {
  const phase = useGameStore((s) => s.phase);
  const lastEvent = useGameStore((s) => s.lastScoreEvent);
  const settings = useGameStore((s) => s.settings);

  const playLabel = formatKeybindLabel(settings.playKeybind);
  const lanes = settings.laneKeys.map((k) => formatKeybindLabel(k)).join(" · ");

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

      <kbd
        title="Toggle auto / manual"
        style={{
          fontSize: "8px",
          fontFamily: "system-ui, Segoe UI, sans-serif",
          fontWeight: 700,
          padding: "2px 5px",
          borderRadius: "4px",
          background: "transparent",
          border: "1px solid rgba(154,154,176,0.4)",
          color: "#1db954",
          whiteSpace: "nowrap",
          flex: "0 0 auto",
        }}
      >
        {playLabel}
      </kbd>

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
          gap: "3px",
          minWidth: 0,
          flex: "1 1 auto",
          justifyContent: "flex-end",
        }}
      >
        <span
          title={lanes}
          style={{
            fontSize: "8px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.88)",
            letterSpacing: "0.05em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            textAlign: "right",
          }}
        >
          {lanes}
        </span>
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
