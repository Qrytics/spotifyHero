import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Compact minimize / maximize / close — native caption controls cannot be scaled on Windows. */
export function WindowChrome(): React.ReactElement | null {
  if (!isTauri()) return null;

  const win = getCurrentWindow();

  function onChromeMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    void win.startDragging();
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        flexShrink: 0,
        height: 24,
        padding: "0 4px",
        background: "var(--surface)",
        borderBottom: "1px solid #222",
        cursor: "default",
      }}
      onMouseDown={onChromeMouseDown}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          gap: 1,
        }}
      >
        <button
          type="button"
          className="window-chrome-btn"
          title="Minimize"
          onClick={() => void win.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="window-chrome-btn"
          title="Maximize"
          onClick={() => void win.toggleMaximize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1" y="1.5" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.1" rx="0.5" />
          </svg>
        </button>
        <button
          type="button"
          className="window-chrome-btn window-chrome-btn-close"
          title="Close"
          onClick={() => void win.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1.8 1.8l6.4 6.4M8.2 1.8L1.8 8.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
