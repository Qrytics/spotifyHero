import React, { useEffect, useState } from "react";
import type { AppSettings, Difficulty } from "@spotifyhero/shared-types";
import { useGameStore } from "../store/gameStore.js";
import { formatKeybindLabel } from "../lib/keybindDisplay.js";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard", "expert"];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SettingsPanel({ open, onClose }: Props): React.ReactElement | null {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);

  const [draft, setDraft] = useState<AppSettings>(settings);

  useEffect(() => {
    if (open) setDraft(settings);
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
    updateSettings(draft);
    onClose();
  };

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
        className="settings-dialog-panel thin-scrollbar"
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
          Use <strong style={{ color: "var(--text)" }}>{formatKeybindLabel(draft.playKeybind)}</strong>{" "}
          during a song to switch{" "}
          <strong style={{ color: "var(--text)" }}>manual</strong> ↔{" "}
          <strong style={{ color: "var(--text)" }}>autoplay</strong>.
        </p>

        <div>
          <label style={labelStyle}>Play mode toggle key</label>
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
              style={{ flex: 1, minWidth: 0 }}
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

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "6px",
            fontSize: "9px",
            color: "var(--text)",
            cursor: "pointer",
            lineHeight: 1.35,
          }}
        >
          <input
            type="checkbox"
            checked={draft.autoplay}
            onChange={(e) => set("autoplay")(e.target.checked)}
            style={{ marginTop: "2px", flexShrink: 0 }}
          />
          Start new songs in autoplay
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
