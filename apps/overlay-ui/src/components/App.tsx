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
import { useSpotifyProfileSync } from "../hooks/useSpotifyProfileSync.js";
import { SpotifyDiagnosticsPanel } from "./SpotifyDiagnosticsPanel.js";
import { ServerDiagnosticsPanel } from "./server/ServerDiagnosticsPanel.js";
import { TrackLoadingIndicator } from "./TrackLoadingIndicator.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { OffsetCalibrator } from "./OffsetCalibrator.js";
import { WindowChrome } from "./WindowChrome.js";
import { loadTauriAppSettings } from "../lib/tauriSettings.js";
import { LeaderboardPanel } from "./LeaderboardPanel.js";
import { SourcePicker } from "./server/SourcePicker.js";
import { ServerLibraryScreen } from "./server/ServerLibraryScreen.js";
import { useActivePlaybackSource } from "../hooks/useActivePlaybackSource.js";
import { useServerChartGeneration } from "../hooks/useServerChartGeneration.js";
import { serverPlaybackSource } from "../lib/playback/activeSource.js";
import {
  clearPreparedAudio,
  setPreparedAudio,
} from "../lib/analysis/preparedAudio.js";

export function App(): React.ReactElement {
  const phase = useGameStore((s) => s.phase);
  const trackLifecycle = useGameStore((s) => s.trackLifecycle);
  const countdownUntilMs = useGameStore((s) => s.countdownUntilMs);
  const chart = useGameStore((s) => s.chart);
  const playback = useGameStore((s) => s.playback);
  const session = useGameStore((s) => s.session);
  const settings = useGameStore((s) => s.settings);
  const usedAutoplayThisRound = useGameStore((s) => s.usedAutoplayThisRound);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calibratorOpen, setCalibratorOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  /** Download / decode failure for a music-server track, shown above the library. */
  const [serverError, setServerError] = useState<string | null>(null);
  // `analysisStage`/`analysisProgress` are subscribed inside
  // `TrackLoadingIndicator`, not here — they update ~80 times per analysis.

  // Core game hooks. `useActivePlaybackSource` goes first: it registers the live
  // source, and everything below reads the clock through that registry.
  useActivePlaybackSource();
  useSpotifySync();
  useSpotifyProfileSync();
  useChartGeneration();
  // Charts a server track from real onset analysis. Exactly one of these two
  // acts on any given track — each returns early on the other's source.
  useServerChartGeneration();
  useGameLoop();
  useKeybinds();

  useEffect(() => {
    void (async () => {
      const tauriSettings = await loadTauriAppSettings();
      if (!tauriSettings) return;
      useGameStore.getState().updateSettings({
        noteScrollSpeed: tauriSettings.noteScrollSpeed,
        window: {
          ...useGameStore.getState().settings.window,
          alwaysOnTop: tauriSettings.alwaysOnTop,
        },
        playbackTimingOffsetMs: tauriSettings.playbackTimingOffsetMs,
        visualNoteOffsetMs: tauriSettings.visualNoteOffsetMs,
        spotifyClientId: tauriSettings.spotifyClientId ?? undefined,
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
  const activeTrackId = chart?.trackId ?? playback?.trackId ?? "";
  const leaderboardEligibleForRanking = session ? !usedAutoplayThisRound : true;

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
          <PlayBottomBar
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenLeaderboard={() => setLeaderboardOpen(true)}
            leaderboardDisabled={!activeTrackId}
          />
        </div>
      )}

      {(trackLifecycle === "loading" || trackLifecycle === "generating") && (
        <TrackLoadingIndicator lifecycle={trackLifecycle} />
      )}
      {/* Countdown overlay intentionally disabled: chart generation is fast enough now. */}

      {phase === "results" && <ResultsScreen />}
      {phase === "idle" && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {settings.musicSource === null ? (
            <SourcePicker />
          ) : settings.musicSource === "spotify" ? (
            <IdleScreen onOpenSettings={() => setSettingsOpen(true)} />
          ) : (
            <>
              {serverError && (
                <div
                  style={{
                    flexShrink: 0,
                    padding: "5px 8px",
                    fontSize: "8px",
                    lineHeight: 1.35,
                    color: "#ff7c7c",
                    background: "rgba(255,80,80,0.08)",
                  }}
                >
                  {serverError}
                </div>
              )}
              <ServerLibraryScreen
                onOpenSettings={() => setSettingsOpen(true)}
                onChangeSource={() =>
                  useGameStore.getState().updateSettings({ musicSource: null })
                }
                onSelectSong={(song, client) => {
                  setServerError(null);
                  const store = useGameStore.getState();
                  // `loading` so the library screen yields to the progress text;
                  // `prepare()` resolves before any audio starts. Handing the
                  // decoded buffer to `setPreparedAudio` is what releases
                  // `useServerChartGeneration`, which is already waiting on it
                  // (`prepare()` writes `playback` into the store before it
                  // resolves, so that hook usually gets there first).
                  store.setPhase("loading");
                  store.setAnalysisProgress("downloading", 0);
                  void serverPlaybackSource()
                    .prepare(client, song, {
                      onProgress: (stage, progress) =>
                        useGameStore
                          .getState()
                          .setAnalysisProgress(stage, progress),
                    })
                    .then(({ track, buffer }) => {
                      setPreparedAudio(track.id, buffer);
                    })
                    .catch((e: unknown) => {
                      setServerError(
                        e instanceof Error ? e.message : String(e)
                      );
                      clearPreparedAudio();
                      const s = useGameStore.getState();
                      s.setAnalysisProgress(null, null);
                      // Back to the library, not `setPlayback({trackId: null})`,
                      // which would land in `paused` with no track.
                      s.resetRound();
                    });
                }}
              />
            </>
          )}
        </div>
      )}
      <LeaderboardPanel
        open={leaderboardOpen && !!activeTrackId}
        onClose={() => setLeaderboardOpen(false)}
        trackId={activeTrackId}
        difficulty={settings.difficulty}
        session={session}
        eligibleForRanking={leaderboardEligibleForRanking}
      />
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenCalibrator={() => {
          setSettingsOpen(false);
          setCalibratorOpen(true);
        }}
      />
      <OffsetCalibrator
        open={calibratorOpen}
        onClose={() => setCalibratorOpen(false)}
      />
      {/* One debug panel at a time (both are fixed to the bottom of the
          window): whichever music source is actually in use. */}
      {settings.musicSource === "server" ? (
        <ServerDiagnosticsPanel />
      ) : (
        <SpotifyDiagnosticsPanel />
      )}
    </div>
  );
}
