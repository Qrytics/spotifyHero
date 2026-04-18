import React, { useCallback, useEffect } from "react";
import {
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Compact minimize / close — no maximize (full work-area overlay felt like it broke the whole desktop). */
export function WindowChrome(): React.ReactElement | null {
  if (!isTauri()) return null;

  const appWindow = getCurrentWindow();

  const clampToWorkArea = useCallback(async (): Promise<void> => {
    const monitor = await currentMonitor();
    if (!monitor) return;
    const area = (monitor as unknown as {
      workArea?: {
        position: { x: number; y: number };
        size: { width: number; height: number };
      };
      position: { x: number; y: number };
      size: { width: number; height: number };
    }).workArea ?? {
      position: monitor.position,
      size: monitor.size,
    };
    const [pos, size] = await Promise.all([appWindow.outerPosition(), appWindow.outerSize()]);

    const clampedX = Math.max(
      area.position.x,
      Math.min(pos.x, area.position.x + area.size.width - size.width)
    );
    const clampedY = Math.max(
      area.position.y,
      Math.min(pos.y, area.position.y + area.size.height - size.height)
    );
    const maxHeight = Math.max(280, area.size.height - 2);
    const maxWidth = Math.max(180, area.size.width - 2);

    if (size.height > maxHeight || size.width > maxWidth) {
      await appWindow.setSize(
        new PhysicalSize(Math.min(size.width, maxWidth), Math.min(size.height, maxHeight))
      );
    }

    if (clampedX !== pos.x || clampedY !== pos.y) {
      await appWindow.setPosition(new PhysicalPosition(clampedX, clampedY));
    }
  }, [appWindow]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      await clampToWorkArea();
      if (cancelled) return;
      const events = ["tauri://resize", "tauri://move", "tauri://scale-change"] as const;
      for (const ev of events) {
        const unlisten = await appWindow.listen(ev, () => {
          void clampToWorkArea();
        });
        if (cancelled) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const u of unlisteners) {
        u();
      }
    };
  }, [appWindow, clampToWorkArea]);

  function onChromeMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    void appWindow.startDragging();
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
        position: "relative",
        /** Above fullscreen overlays (calibration, settings) so the strip stays draggable. */
        zIndex: 10050,
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
          onClick={() => void appWindow.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="window-chrome-btn window-chrome-btn-close"
          title="Close"
          onClick={() => void appWindow.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1.8 1.8l6.4 6.4M8.2 1.8L1.8 8.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
