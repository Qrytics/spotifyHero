import React, { useEffect, useState } from "react";
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
import { WindowChrome } from "./WindowChrome.js";
import { loadTauriAppSettings } from "../lib/tauriSettings.js";

export function App(): React.ReactElement {
  const phase = useGameStore((s) => s.phase);
  const trackLifecycle = useGameStore((s) => s.trackLifecycle);
  const countdownUntilMs = useGameStore((s) => s.countdownUntilMs);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());

  // Core game hooks
  useSpotifySync();
  useChartGeneration();
  useGameLoop();
  useKeybinds();

  useEffect(() => {
    void (async () => {
      const tauriSettings = await loadTauriAppSettings();
      if (!tauriSettings) return;
      useGameStore.getState().updateSettings({
        noteScrollSpeed: tauriSettings.noteScrollSpeed,
      });
    })();
  }, []);

  useEffect(() => {
    if (trackLifecycle !== "countdown") return;
    const timer = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 80);
    return () => window.clearInterval(timer);
  }, [trackLifecycle]);

  const countdownStep =
    trackLifecycle === "countdown" && countdownUntilMs !== null
      ? Math.max(1, Math.ceil((countdownUntilMs - countdownNowMs) / 1000))
      : null;

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
      <WindowChrome />
      {(phase === "autoplay" || phase === "manual" || phase === "paused") && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <HUD />
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <NoteHighway />
          </div>
          <PlayBottomBar onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      )}

      {(trackLifecycle === "loading" || trackLifecycle === "generating") && (
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
          {trackLifecycle === "generating" ? "Generating chart…" : "Loading track…"}
        </div>
      )}
      {trackLifecycle === "countdown" && (
        <div className="countdown-overlay">
          <div className="countdown-generating">Generating…</div>
          <div className="countdown-bubble">{countdownStep ?? 1}</div>
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
