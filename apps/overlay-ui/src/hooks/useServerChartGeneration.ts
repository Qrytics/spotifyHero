import { useEffect } from "react";
import { HybridChartGenerator } from "@spotifyhero/chart-generator";
import type { Chart } from "@spotifyhero/shared-types";
import type { OnsetAnalysisResult } from "@spotifyhero/onset-analysis";
import { useGameStore } from "../store/gameStore.js";
import {
  analyzeAudioBuffer,
  AnalysisAbortedError,
} from "../lib/analysis/analyzeAudioBuffer.js";
import {
  PreparedAudioAbortedError,
  waitForPreparedAudio,
} from "../lib/analysis/preparedAudio.js";
import {
  getCachedAnalysis,
  getCachedChart,
  putCachedAnalysis,
  putCachedChart,
} from "../lib/chartCache.js";
import {
  buildServerChartDiagnostics,
  publishServerDiagnostics,
  type ServerChartServedFrom,
} from "../lib/serverDiagnostics.js";

/**
 * useServerChartGeneration
 *
 * The music-server counterpart to `useChartGeneration`: same trigger (`phase ===
 * "loading"`), but it charts from **real onset analysis** of the decoded audio
 * instead of `demoBeatEvents`' synthetic grid. Only one of the two hooks acts on
 * any given track — each returns early on the other's `playback.source`.
 *
 * The pipeline, and where each step can already be satisfied from cache:
 *
 *   chart cache → done
 *   analysis cache → generate()                        (difficulty change)
 *   decoded buffer → analyse → generate()              (first play)
 *
 * `settings.difficulty` is read at generate time rather than being an effect
 * dependency. A difficulty change routes through `updateSettings`, which sets
 * `phase: "loading"` and clears the chart — so this effect re-runs anyway, and
 * keeping difficulty out of the dependency list means an in-flight analysis is
 * never restarted just because the user toggled difficulty while it ran.
 */
export function useServerChartGeneration(): void {
  const phase = useGameStore((s) => s.phase);
  const trackId = useGameStore((s) => s.playback?.trackId ?? null);
  const source = useGameStore((s) => s.playback?.source ?? null);

  useEffect(() => {
    if (phase !== "loading" || !trackId || source !== "server") return;

    const controller = new AbortController();
    let cancelled = false;

    /** The track and phase this run was started for are still the current ones. */
    const stillWanted = (): boolean => {
      if (cancelled) return false;
      const s = useGameStore.getState();
      return s.phase === "loading" && s.playback?.trackId === trackId;
    };

    void (async () => {
      const store = useGameStore.getState();
      const difficulty = store.settings.difficulty;

      /** Ctrl+Shift+D panel. Cheap, and off the gameplay path — nothing runs yet. */
      const publishDiagnostics = (
        chart: Chart,
        analysis: OnsetAnalysisResult | null,
        servedFrom: ServerChartServedFrom,
        analyzeMs: number | null,
        generateMs: number | null
      ): void => {
        try {
          publishServerDiagnostics(
            buildServerChartDiagnostics({
              chart,
              trackName: useGameStore.getState().playback?.track?.name ?? null,
              servedFrom,
              analysis,
              analyzeMs,
              generateMs,
            })
          );
        } catch (err) {
          // Diagnostics must never be why a chart fails to load.
          console.warn("[spotifyHero] diagnostics failed:", err);
        }
      };

      try {
        const cachedChart = getCachedChart(trackId, difficulty);
        if (cachedChart) {
          if (!stillWanted()) return;
          // The analysis may still be in memory even when the chart came from
          // localStorage; it is only ever used to enrich the panel.
          publishDiagnostics(
            cachedChart,
            getCachedAnalysis(trackId) ?? null,
            "chart-cache",
            null,
            null
          );
          useGameStore.getState().setAnalysisProgress(null, null);
          useGameStore.getState().setChart(cachedChart);
          return;
        }

        useGameStore.setState({ trackLifecycle: "generating" });

        let analyzeMs: number | null = null;
        let analysis = getCachedAnalysis(trackId);
        const servedFrom: ServerChartServedFrom = analysis
          ? "analysis-cache"
          : "analysis";
        if (!analysis) {
          // `prepare()` writes `playback` into the store before it resolves, so
          // this effect can easily get here first. Waiting is cheaper than
          // re-plumbing that ordering, and the abort signal makes it safe.
          const buffer = await waitForPreparedAudio(trackId, controller.signal);
          if (!stillWanted()) return;
          useGameStore.getState().setAnalysisProgress("analyzing", 0);

          const analyzeStartedMs = performance.now();
          analysis = await analyzeAudioBuffer(buffer, {
            signal: controller.signal,
            onProgress: (progress) => {
              if (!cancelled) {
                useGameStore
                  .getState()
                  .setAnalysisProgress("analyzing", progress);
              }
            },
          });
          analyzeMs = performance.now() - analyzeStartedMs;
          if (!stillWanted()) return;
          putCachedAnalysis(trackId, analysis);
        }

        // Generation is a few ms, but the label should not read "Analyzing 100%"
        // while it happens.
        useGameStore.getState().setAnalysisProgress("charting", null);

        const generateStartedMs = performance.now();
        const chart = await new HybridChartGenerator().generate(
          trackId,
          // The generator mutates nothing, and the cached analysis is reused for
          // the next difficulty, so the same array is safe to hand over.
          analysis.events,
          analysis.bpm,
          {
            difficulty,
            // Real audio, so the master's loudness is known — the silence gate's
            // absolute thresholds are scaled to it instead of assuming
            // "balanced" as the Spotify path must.
            normalizationProfile: analysis.normalizationProfile,
          }
        );

        const generateMs = performance.now() - generateStartedMs;

        if (!stillWanted()) return;
        publishDiagnostics(chart, analysis, servedFrom, analyzeMs, generateMs);
        putCachedChart(chart);
        // Clears `analysisStage`/`analysisProgress` and moves to `autoplay`,
        // which is what starts the audio in `useActivePlaybackSource`.
        useGameStore.getState().setChart(chart);
      } catch (err) {
        if (
          err instanceof AnalysisAbortedError ||
          err instanceof PreparedAudioAbortedError ||
          cancelled
        ) {
          return;
        }
        console.error("[spotifyHero] server chart generation failed:", err);
        const s = useGameStore.getState();
        s.setAnalysisProgress(null, null);
        // Back to the library rather than `setPhase("idle")`: an idle phase with
        // a server `playback` still set would offer a track with no chart.
        s.resetRound();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [phase, trackId, source]);
}
