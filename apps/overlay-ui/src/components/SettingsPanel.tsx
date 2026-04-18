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

  const save = () => {
    updateSettings(draft);
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    fontSize: "12px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "#12121a",
    color: "var(--text)",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "10px",
    color: "var(--text-muted)",
    marginBottom: "4px",
    display: "block",
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
        padding: "16px",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "320px",
          maxHeight: "90%",
          overflow: "auto",
          background: "var(--surface)",
          borderRadius: "12px",
          border: "1px solid #2a2a32",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)" }}>
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
              fontSize: "18px",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.45, margin: 0 }}>
          Use <strong style={{ color: "var(--text)" }}>{formatKeybindLabel(draft.playKeybind)}</strong>{" "}
          during a song to switch between{" "}
          <strong style={{ color: "var(--text)" }}>manual</strong> (you hit lanes) and{" "}
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
          <span style={{ fontSize: "9px", color: "#666", marginTop: "4px", display: "block" }}>
            Type <code style={{ color: "var(--accent)" }}>Space</code> or a letter (e.g.{" "}
            <code style={{ color: "var(--accent)" }}>p</code>).
          </span>
        </div>

        <div>
          <span style={labelStyle}>Lane keys (left → right)</span>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "6px",
            }}
          >
            {([0, 1, 2, 3] as const).map((i) => (
              <input
                key={i}
                style={{ ...inputStyle, textAlign: "center", padding: "8px 4px" }}
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

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "11px",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={draft.autoplay}
            onChange={(e) => set("autoplay")(e.target.checked)}
          />
          Start new songs in autoplay (otherwise manual first)
        </label>

        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <button
            type="button"
            onClick={save}
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: "8px",
              border: "none",
              background: "var(--accent)",
              color: "#0d0d0f",
              fontWeight: 700,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 14px",
              borderRadius: "8px",
              border: "1px solid #444",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: "12px",
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
