import React from "react";
import { useGameStore } from "../store/gameStore.js";
import { formatKeybindLabel } from "../lib/keybindDisplay.js";

/**
 * Bottom status strip: mode · toggle key · last judgement · lane keys.
 * Compact typography so narrow overlay windows (Tauri) do not clip content.
 */
export function PlayBottomBar(): React.ReactElement {
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
      fontSize: "9px",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.03em",
      whiteSpace: "nowrap",
      flexShrink: 0,
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
      style={{
        flexShrink: 0,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: "10px",
        rowGap: "4px",
        padding: "5px 8px",
        background: "#06060c",
        borderTop: "1px solid rgba(74,74,92,0.85)",
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
          minWidth: 0,
          flex: "1 1 auto",
        }}
      >
        {modeLabel ? (
          <span
            style={{
              fontSize: "9px",
              fontWeight: 700,
              color: modeColor,
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}
          >
            {modeLabel}
          </span>
        ) : null}

        <kbd
          title="Toggle auto / manual"
          style={{
            fontSize: "9px",
            fontFamily: "system-ui, Segoe UI, sans-serif",
            fontWeight: 700,
            padding: "3px 7px",
            borderRadius: "6px",
            background: "transparent",
            border: "1px solid rgba(154,154,176,0.45)",
            color: "#1db954",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {playLabel}
        </kbd>

        {lastEvent ? (
          <span style={judgementStyle(lastEvent.judgement)}>
            {lastEvent.judgement}
          </span>
        ) : (
          <span
            style={{
              fontSize: "9px",
              fontWeight: 600,
              color: "#444",
              letterSpacing: "0.05em",
            }}
          >
            —
          </span>
        )}
      </div>

      <span
        title={lanes}
        style={{
          fontSize: "9px",
          fontWeight: 600,
          color: "rgba(255,255,255,0.88)",
          letterSpacing: "0.06em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
          flex: "1 1 120px",
          maxWidth: "100%",
          textAlign: "right",
        }}
      >
        {lanes}
      </span>
    </div>
  );
}
