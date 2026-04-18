import React, { useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { NoteHighway } from "./NoteHighway.js";
import { HUD } from "./HUD.js";
import { PlayBottomBar } from "./PlayBottomBar.js";
import { ResultsScreen } from "./ResultsScreen.js";
import { IdleScreen } from "./IdleScreen.js";
import { useSpotifySync } from "../hooks/useSpotifySync.js";
import { useChartGeneration } from "../hooks/useChartGeneration.js";
import { useGameLoop } from "../hooks/useGameLoop.js";
import { useKeybinds } from "../hooks/useKeybinds.js";
import { SpotifyDiagnosticsPanel } from "./SpotifyDiagnosticsPanel.js";
import { SettingsPanel } from "./SettingsPanel.js";

export function App(): React.ReactElement {
  const phase = useGameStore((s) => s.phase);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Core game hooks
  useSpotifySync();
  useChartGeneration();
  useGameLoop();
  useKeybinds();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: "var(--bg)",
      }}
    >
      {(phase === "autoplay" || phase === "manual" || phase === "paused") && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <HUD onOpenSettings={() => setSettingsOpen(true)} />
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <NoteHighway />
          </div>
          <PlayBottomBar />
        </div>
      )}

      {phase === "loading" && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
            fontSize: "14px",
          }}
        >
          Generating chart…
        </div>
      )}

      {phase === "results" && <ResultsScreen />}
      {phase === "idle" && (
        <IdleScreen onOpenSettings={() => setSettingsOpen(true)} />
      )}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SpotifyDiagnosticsPanel />
    </div>
  );
}
