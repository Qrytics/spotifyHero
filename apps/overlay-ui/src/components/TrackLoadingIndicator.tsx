import React from "react";
import { useGameStore, type TrackLifecycleState } from "../store/gameStore.js";

/**
 * Music-server pipeline stages, shown in place of "Loading track…". A download
 * plus an analysis can take tens of seconds, so silence here reads as a hang.
 *
 * Order matters: it is also the "step N of 4" counter.
 */
const STAGES = [
  { key: "downloading", label: "Downloading" },
  { key: "decoding", label: "Decoding" },
  { key: "analyzing", label: "Analyzing" },
  { key: "charting", label: "Building chart" },
] as const;

/**
 * Loading text for both music sources, plus a progress bar for the music-server
 * pipeline.
 *
 * The `analysisStage`/`analysisProgress` subscriptions live **here** rather than
 * in `App`: progress lands in the store roughly every 256 STFT frames (~80
 * updates for a 4-minute track), and this component is a few hundred bytes of
 * DOM instead of the whole app tree.
 */
export function TrackLoadingIndicator({
  lifecycle,
}: {
  lifecycle: TrackLifecycleState;
}): React.ReactElement {
  const analysisStage = useGameStore((s) => s.analysisStage);
  const analysisProgress = useGameStore((s) => s.analysisProgress);
  const trackName = useGameStore((s) => s.playback?.track?.name ?? null);

  // Spotify path: unchanged single line of text, no bar (there is nothing to
  // measure — `useChartGeneration` is synchronous).
  if (analysisStage === null) {
    return (
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
        {lifecycle === "generating" ? "Generating chart…" : "Loading track…"}
      </div>
    );
  }

  const stageIndex = STAGES.findIndex((s) => s.key === analysisStage);
  const stage = STAGES[stageIndex === -1 ? 0 : stageIndex]!;
  const percent =
    analysisProgress === null
      ? null
      : Math.max(0, Math.min(100, Math.round(analysisProgress * 100)));

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "0 14px",
      }}
    >
      {trackName && (
        <div
          className="sh-lib-row-sub"
          style={{ maxWidth: "100%", textAlign: "center" }}
        >
          {trackName}
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "5px",
          color: "var(--accent-library)",
          fontSize: "11px",
        }}
      >
        <span>{stage.label}</span>
        {percent !== null && (
          <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "10px" }}>
            {percent}%
          </span>
        )}
      </div>
      <div
        className="sh-lib-progress"
        role="progressbar"
        aria-label={stage.label}
        {...(percent !== null
          ? { "aria-valuenow": percent, "aria-valuemin": 0, "aria-valuemax": 100 }
          : {})}
      >
        <div
          className={
            percent === null
              ? "sh-lib-progress-fill sh-lib-progress-fill-indeterminate"
              : "sh-lib-progress-fill"
          }
          {...(percent !== null ? { style: { width: `${percent}%` } } : {})}
        />
      </div>
      <div className="sh-lib-row-sub">
        Step {(stageIndex === -1 ? 0 : stageIndex) + 1} of {STAGES.length}
      </div>
    </div>
  );
}
