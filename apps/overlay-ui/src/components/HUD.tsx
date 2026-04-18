import React from "react";
import { useGameStore } from "../store/gameStore.js";

type Props = {
  onOpenSettings: () => void;
};

/**
 * HUD – track info, score, settings entry (mode/keybind/judgement bar lives in PlayBottomBar).
 */
export function HUD({ onOpenSettings }: Props): React.ReactElement {
  const score = useGameStore((s) => s.score);
  const combo = useGameStore((s) => s.combo);
  const playback = useGameStore((s) => s.playback);

  const trackName = playback?.track?.name ?? "—";
  const artist = playback?.track?.artists.join(", ") ?? "";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px 10px 6px",
        background: "var(--surface)",
        borderBottom: "1px solid #222",
        gap: "4px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "6px",
        }}
      >
        <div
          style={{
            flex: 1,
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              lineHeight: 1.25,
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
        <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            style={{
              border: "1px solid #333",
              background: "#222",
              color: "var(--text-muted)",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "11px",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ⚙
          </button>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "12px", fontWeight: 800, color: "var(--text)" }}>
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
      </div>
    </div>
  );
}
