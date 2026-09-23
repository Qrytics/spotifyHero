import React, { useCallback, useEffect, useState } from "react";
import {
  isSpotifyDebugPanelEnabled,
  SPOTIFY_DEBUG_STORAGE_KEY,
} from "../../lib/spotifyDiagnostics.js";
import {
  readServerDiagnostics,
  SERVER_DIAGNOSTICS_EVENT,
  serverDiagnosticsToClipboardText,
  type ServerChartDiagnostics,
} from "../../lib/serverDiagnostics.js";

const BAR_GLYPHS = "▁▂▃▄▅▆▇█";

/** Confidence histogram as one line of sparkline, scaled to its own max. */
function sparkline(counts: readonly number[]): string {
  const max = counts.reduce((m, c) => (c > m ? c : m), 0);
  if (max === 0) return "—";
  let out = "";
  for (const c of counts) {
    const idx =
      c === 0 ? 0 : Math.min(BAR_GLYPHS.length - 1, Math.ceil((c / max) * (BAR_GLYPHS.length - 1)));
    out += c === 0 ? "·" : BAR_GLYPHS[idx]!;
  }
  return out;
}

function n(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "–";
}

function ms(value: number | null): string {
  return value === null ? "–" : `${Math.round(value)} ms`;
}

function Row({
  label,
  children,
  warn,
}: {
  label: string;
  children: React.ReactNode;
  warn?: boolean;
}): React.ReactElement {
  return (
    <div style={{ display: "flex", gap: "6px", justifyContent: "space-between" }}>
      <span style={{ color: "#888" }}>{label}</span>
      <span style={{ color: warn ? "#ffb066" : "#ddd", textAlign: "right" }}>{children}</span>
    </div>
  );
}

/**
 * Music-server counterpart to `SpotifyDiagnosticsPanel`, same toggle
 * (**Ctrl+Shift+D** / `localStorage.setItem('spotifyHero_debug','1')`).
 *
 * It exists for one job the Spotify panel has no equivalent of: showing where
 * the real flux-derived confidence distribution sits relative to the
 * `DIFFICULTY_PARAMS` thresholds it is compared against, so those thresholds can
 * be tuned against numbers. Empty-chart and no-sustain outcomes are called out
 * explicitly rather than left to be inferred from the histogram.
 */
export function ServerDiagnosticsPanel(): React.ReactElement | null {
  const [open, setOpen] = useState(isSpotifyDebugPanelEnabled);
  const [diag, setDiag] = useState<ServerChartDiagnostics | null>(() =>
    readServerDiagnostics()
  );
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    const syncOpen = () => setOpen(isSpotifyDebugPanelEnabled());
    const onDiag = (ev: Event) => {
      const ce = ev as CustomEvent<ServerChartDiagnostics>;
      if (ce.detail) setDiag(ce.detail);
    };
    window.addEventListener("spotifyhero-debug-toggle", syncOpen);
    window.addEventListener(SERVER_DIAGNOSTICS_EVENT, onDiag);
    return () => {
      window.removeEventListener("spotifyhero-debug-toggle", syncOpen);
      window.removeEventListener(SERVER_DIAGNOSTICS_EVENT, onDiag);
    };
  }, []);

  const copy = useCallback(async () => {
    const d = readServerDiagnostics();
    if (!d) return;
    try {
      await navigator.clipboard.writeText(serverDiagnosticsToClipboardText(d));
    } catch {
      /* ignore */
    }
  }, []);

  if (!open) return null;

  const conf = diag?.analysis?.confidence ?? null;
  const emptyChart = diag !== null && diag.chart.noteCount === 0;
  const noSustains = diag !== null && diag.chart.sustainCount === 0;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "52%",
        overflow: "auto",
        zIndex: 9999,
        background: "rgba(12,12,14,0.97)",
        borderTop: "1px solid #333",
        fontFamily: "ui-monospace, monospace",
        fontSize: "10px",
        lineHeight: 1.45,
        color: "#ddd",
        padding: "10px 12px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--accent-library)", fontWeight: 700 }}>
          Chart diagnostics
        </span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            style={{
              fontSize: "10px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: showJson ? "#2a2440" : "#222",
              color: "#eee",
              cursor: "pointer",
            }}
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            style={{
              fontSize: "10px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: "#222",
              color: "#eee",
              cursor: "pointer",
            }}
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(SPOTIFY_DEBUG_STORAGE_KEY, "0");
              } catch {
                /* ignore */
              }
              setOpen(false);
              window.dispatchEvent(new CustomEvent("spotifyhero-debug-toggle"));
            }}
            style={{
              fontSize: "10px",
              padding: "4px 10px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: "transparent",
              color: "#888",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>

      {!diag && (
        <div style={{ color: "#888" }}>
          Waiting for the first music-server chart…{" "}
          <code style={{ color: "#9cf" }}>window.__spotifyHeroServerDiagnostics</code>
        </div>
      )}

      {diag && showJson && (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {JSON.stringify(diag, null, 2)}
        </pre>
      )}

      {diag && !showJson && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
          <div style={{ color: "#eee", marginBottom: "3px" }}>
            {diag.trackName ?? diag.trackId}
          </div>
          <Row label="difficulty">
            {diag.difficulty} · {diag.servedFrom}
          </Row>
          <Row label="analyse / generate">
            {ms(diag.timingsMs.analyze)} / {ms(diag.timingsMs.generate)}
          </Row>
          <Row label="clock">
            {diag.clock.isExact ? "exact" : "extrapolating"} · out{" "}
            {n(diag.clock.outputLatencyMs, 1)} ms
          </Row>

          {diag.analysis && (
            <>
              <div style={{ color: "var(--accent-library)", marginTop: "6px" }}>analysis</div>
              <Row label="bpm / phase">
                {n(diag.analysis.bpm, 1)} · {Math.round(diag.analysis.beatPhaseMs)} ms · conf{" "}
                {n(diag.analysis.stats.tempoConfidence)}
              </Row>
              <Row label="onsets (grid)">
                {diag.analysis.stats.onsetCount} ({diag.analysis.stats.gridAlignedOnsetCount}) ·{" "}
                {diag.analysis.stats.beatEventCount} beats
              </Row>
              <Row label="pitched">
                {diag.analysis.stats.pitchedOnsetCount} / {diag.analysis.stats.onsetCount}
              </Row>
              <Row label="flux med / p95">
                {n(diag.analysis.stats.fluxMedian, 4)} / {n(diag.analysis.stats.fluxP95, 4)}
              </Row>
              <Row label="rms / amp p90">
                {n(diag.analysis.stats.rmsP90, 4)} / {n(diag.analysis.stats.amplitudeP90, 4)} ·{" "}
                {diag.analysis.normalizationProfile}
              </Row>
            </>
          )}

          {conf && (
            <>
              <div style={{ color: "var(--accent-library)", marginTop: "6px" }}>
                confidence (onsets)
              </div>
              <Row label="min/med/p90/max">
                {n(conf.min)} / {n(conf.median)} / {n(conf.p90)} / {n(conf.max)}
              </Row>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "6px",
                  color: "#9cf",
                  letterSpacing: "1px",
                }}
              >
                <span style={{ color: "#888", letterSpacing: 0 }}>0 → 1</span>
                <span>{sparkline(conf.histogram)}</span>
              </div>
              <Row label={`> floor ${n(diag.thresholds.onsetConfidenceFloor)}`} warn={emptyChart}>
                {conf.aboveOnsetFloor} / {conf.onsetCount}
              </Row>
              <Row
                label={`≥ sustain ${n(diag.thresholds.sustainConfidenceMin)}`}
                warn={noSustains}
              >
                {conf.aboveSustainMin} / {conf.onsetCount}
              </Row>
            </>
          )}

          <div style={{ color: "var(--accent-library)", marginTop: "6px" }}>chart</div>
          <Row label="notes" warn={emptyChart}>
            {diag.chart.noteCount} · {n(diag.chart.notesPerMinute, 1)}/min
          </Row>
          <Row label="sustains" warn={noSustains}>
            {diag.chart.sustainCount} ({n(diag.chart.sustainPercent * 100, 1)}%, target{" "}
            {n(diag.thresholds.minSustainPercent * 100, 0)}–
            {n(diag.thresholds.maxSustainPercent * 100, 0)}%) · max{" "}
            {Math.round(diag.chart.longestSustainMs)} ms
          </Row>
          <Row label="gap min / med">
            {ms(diag.chart.minGapMs)} / {ms(diag.chart.medianGapMs)} (min{" "}
            {diag.thresholds.minGapMs})
          </Row>
          <Row label="lanes">{diag.chart.laneCounts.join(" / ")}</Row>
          <Row label="generator">{diag.chart.generatorVersion}</Row>

          {emptyChart && (
            <div style={{ color: "#ffb066", marginTop: "5px" }}>
              Empty chart — every onset fell at or below `onsetConfidenceFloor`, or the silence
              gate rejected them. Compare the histogram against the floor above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
