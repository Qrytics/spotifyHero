import React, { useEffect, useState } from "react";
import type { AppSettings, Difficulty } from "@spotifyhero/shared-types";
import { AppSettingsSchema } from "@spotifyhero/shared-types";
import { useGameStore } from "../store/gameStore.js";
import { formatKeybindLabel } from "../lib/keybindDisplay.js";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert"];

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenCalibrator?: () => void;
};

export function SettingsPanel({
  open,
  onClose,
  onOpenCalibrator,
}: Props): React.ReactElement | null {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);

  const [draft, setDraft] = useState<AppSettings>(settings);
  /** Free-typed until Save; validated with AppSettingsSchema (32 hex or empty). */
  const [spotifyClientIdInput, setSpotifyClientIdInput] = useState("");
  const [spotifyClientIdError, setSpotifyClientIdError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setSpotifyClientIdInput(settings.spotifyClientId ?? "");
      setSpotifyClientIdError(null);
    }
  }, [open, settings]);

  if (!open) return null;

  const set =
    <K extends keyof AppSettings>(key: K) =>
    (value: AppSettings[K]) => {
      setDraft((d) => ({ ...d, [key]: value }));
    };

  const setLane = (laneIdx: 0 | 1 | 2 | 3, value: string) => {
    const ch = value.slice(-1).toLowerCase();
    const next = [...draft.laneKeys] as [string, string, string, string];
    next[laneIdx] = ch || next[laneIdx];
    setDraft((d) => ({ ...d, laneKeys: next }));
  };

  const onSpeedInput = (raw: string) => {
    const next = Number.parseFloat(raw);
    if (!Number.isFinite(next)) return;
    set("noteScrollSpeed")(next);
  };

  const save = () => {
    const cid = spotifyClientIdInput.trim();
    const merged = { ...draft, spotifyClientId: cid === "" ? ("" as const) : cid };
    const parsed = AppSettingsSchema.safeParse(merged);
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors.spotifyClientId?.[0];
      setSpotifyClientIdError(
        msg ?? "Spotify Client ID must be empty or exactly 32 hex characters."
      );
      return;
    }
    setSpotifyClientIdError(null);
    updateSettings(parsed.data);
    onClose();
  };
  const speedFillPct = `${((draft.noteScrollSpeed - 0.45) / (5 - 0.45)) * 100}%`;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "4px 8px",
    fontSize: "11px",
    lineHeight: 1.3,
    borderRadius: "4px",
    border: "1px solid #333",
    background: "#12121a",
    color: "var(--text)",
    boxSizing: "border-box",
    appearance: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "9px",
    color: "var(--text-muted)",
    marginBottom: "3px",
    display: "block",
    fontWeight: 600,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="settings-dialog-panel"
        style={{
          width: "100%",
          maxWidth: "300px",
          maxHeight: "min(88vh, 520px)",
          overflowY: "auto",
          overflowX: "hidden",
          background: "var(--surface)",
          borderRadius: "8px",
          border: "1px solid #2a2a32",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text)" }}>
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: 1,
              padding: "2px 4px",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.4, margin: 0 }}>
          <strong style={{ color: "var(--text)" }}>Lane keys</strong> hit notes and switch from{" "}
          <strong style={{ color: "var(--text)" }}>autoplay</strong> to{" "}
          <strong style={{ color: "var(--text)" }}>manual</strong> (no play key needed).{" "}
          <strong style={{ color: "var(--text)" }}>{formatKeybindLabel(draft.playKeybind)}</strong>{" "}
          is optional to toggle modes anytime.
        </p>

        <div>
          <label style={labelStyle}>Spotify Client ID (optional)</label>
          <input
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: "10px" }}
            value={spotifyClientIdInput}
            onChange={(e) => {
              setSpotifyClientIdInput(e.target.value);
              setSpotifyClientIdError(null);
            }}
            placeholder="Leave empty for default app"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(spotifyClientIdError)}
          />
          <span style={{ fontSize: "8px", color: "#666", marginTop: "2px", display: "block" }}>
            Use your own{" "}
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)" }}
            >
              Spotify app
            </a>{" "}
            so you do not need to be on the developer allowlist. Redirect URI must be exactly{" "}
            <code style={{ color: "var(--accent)", fontSize: "8px" }}>http://127.0.0.1:8888/callback</code>
            . Changing this clears the current Spotify link — connect again.
          </span>
          {spotifyClientIdError && (
            <span style={{ fontSize: "8px", color: "#f66", marginTop: "4px", display: "block" }}>
              {spotifyClientIdError}
            </span>
          )}
        </div>

        <div>
          <label style={labelStyle}>Play mode toggle key (optional)</label>
          <input
            style={inputStyle}
            value={draft.playKeybind}
            onChange={(e) => set("playKeybind")(e.target.value)}
            placeholder="Space"
            autoComplete="off"
            spellCheck={false}
          />
          <span style={{ fontSize: "8px", color: "#666", marginTop: "2px", display: "block" }}>
            <code style={{ color: "var(--accent)" }}>Space</code> or a letter.
          </span>
        </div>

        <div>
          <span style={labelStyle}>Lane keys (left → right)</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "4px",
            }}
          >
            {([0, 1, 2, 3] as const).map((i) => (
              <input
                key={i}
                style={{ ...inputStyle, textAlign: "center", padding: "4px 2px" }}
                maxLength={8}
                value={draft.laneKeys[i]}
                onChange={(e) => setLane(i, e.target.value)}
                aria-label={`Lane ${i + 1} key`}
              />
            ))}
          </div>
        </div>

        <div>
          <label style={labelStyle}>Difficulty</label>
          <select
            style={inputStyle}
            value={draft.difficulty}
            onChange={(e) => set("difficulty")(e.target.value as Difficulty)}
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Note scroll speed</label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="range"
              className="speed-range"
              style={{ flex: 1, minWidth: 0, ["--range-fill" as string]: speedFillPct }}
              min={0.45}
              max={5}
              step={0.05}
              value={draft.noteScrollSpeed}
              onInput={(e) => onSpeedInput(e.currentTarget.value)}
              onChange={(e) => onSpeedInput(e.currentTarget.value)}
              aria-valuemin={0.45}
              aria-valuemax={5}
            />
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "var(--accent)",
                width: "38px",
                flexShrink: 0,
              }}
            >
              {draft.noteScrollSpeed.toFixed(2)}×
            </span>
          </div>
          <span style={{ fontSize: "8px", color: "#666", marginTop: "2px", display: "block" }}>
            Higher = notes move faster toward the hit line.
          </span>
        </div>

        <div>
          <label style={labelStyle}>Hit timing offset (ms)</label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="range"
              style={{ flex: 1, minWidth: 0 }}
              min={-500}
              max={500}
              step={5}
              value={draft.playbackTimingOffsetMs}
              onChange={(e) =>
                set("playbackTimingOffsetMs")(Number.parseInt(e.target.value, 10))
              }
            />
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "var(--accent)",
                width: "44px",
                flexShrink: 0,
              }}
            >
              {draft.playbackTimingOffsetMs >= 0 ? "+" : ""}
              {draft.playbackTimingOffsetMs}
            </span>
          </div>
          <span style={{ fontSize: "8px", color: "#666", marginTop: "2px", display: "block" }}>
            Negative = chart slightly earlier. Use the wizard for automatic setup.
          </span>
          {onOpenCalibrator && (
            <button
              type="button"
              onClick={() => {
                onOpenCalibrator();
              }}
              style={{
                marginTop: "8px",
                width: "100%",
                padding: "6px 8px",
                borderRadius: "6px",
                border: "1px solid var(--accent)",
                background: "transparent",
                color: "var(--accent)",
                fontWeight: 600,
                fontSize: "10px",
                cursor: "pointer",
              }}
            >
              Calibrate timing…
            </button>
          )}
        </div>

        <div>
          <label style={labelStyle}>Visual note offset (ms)</label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="range"
              style={{ flex: 1, minWidth: 0 }}
              min={-250}
              max={250}
              step={5}
              value={draft.visualNoteOffsetMs}
              onChange={(e) =>
                set("visualNoteOffsetMs")(Number.parseInt(e.target.value, 10))
              }
            />
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "var(--accent)",
                width: "44px",
                flexShrink: 0,
              }}
            >
              {draft.visualNoteOffsetMs >= 0 ? "+" : ""}
              {draft.visualNoteOffsetMs}
            </span>
          </div>
          <span style={{ fontSize: "8px", color: "#666", marginTop: "2px", display: "block" }}>
            Visual-only shift for where notes meet the receptor.
          </span>
        </div>

        <label className="sh-switch-row">
          <span className="sh-switch-copy">
            <span className="sh-switch-title">Start new songs in autoplay</span>
          </span>
          <input
            className="sh-switch-input"
            type="checkbox"
            checked={draft.autoplay}
            onChange={(e) => set("autoplay")(e.target.checked)}
          />
          <span className="sh-switch-track" aria-hidden>
            <span className="sh-switch-thumb" />
          </span>
        </label>

        <label className="sh-switch-row">
          <span className="sh-switch-copy">
            <span className="sh-switch-title">Keep overlay always on top</span>
            <span className="sh-switch-subtitle">Disable if the overlay blocks desktop/window navigation.</span>
          </span>
          <input
            className="sh-switch-input"
            type="checkbox"
            checked={draft.window.alwaysOnTop}
            onChange={(e) =>
              set("window")({ ...draft.window, alwaysOnTop: e.target.checked })
            }
          />
          <span className="sh-switch-track" aria-hidden>
            <span className="sh-switch-thumb" />
          </span>
        </label>

        <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
          <button
            type="button"
            onClick={save}
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: "6px",
              border: "none",
              background: "var(--accent)",
              color: "#0d0d0f",
              fontWeight: 700,
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid #444",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
