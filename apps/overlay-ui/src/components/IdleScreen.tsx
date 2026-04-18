import React from "react";
import { useGameStore } from "../store/gameStore.js";

export function IdleScreen(): React.ReactElement {
  const settings = useGameStore((s) => s.settings);

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
        Play a song in Spotify to start.
        <br />
        Press <kbd style={{ background: "#222", padding: "1px 4px", borderRadius: "3px" }}>
          {settings.playKeybind}
        </kbd> to toggle manual play.
      </div>
    </div>
  );
}
