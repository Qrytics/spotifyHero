import React, { useRef, useEffect, useState } from "react";
import { Application, Graphics, Text, TextStyle } from "pixi.js";
import { useGameStore } from "../store/gameStore.js";

const LANE_COLORS = [0xe040fb, 0x1db954, 0xff9800, 0x2196f3];
const LANE_COUNT = 4;
const NOTE_RADIUS = 14;
const HIT_LINE_Y_FRACTION = 0.82; // % down the canvas where the hit zone is

/**
 * NoteHighway
 *
 * PixiJS-backed canvas that renders the falling note highway.
 * Notes are sourced from the active Chart in the game store and
 * positioned based on the current playback position.
 */
export function NoteHighway(): React.ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const chart = useGameStore((s) => s.chart);
  /** False until `Application.init()` completes — avoids destroying before plugins (resize) exist (React Strict Mode). */
  const [pixiReady, setPixiReady] = useState(false);

  // Initialise PixiJS once — async-safe for Strict Mode double mount/unmount.
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    let disposed = false;
    let tornDown = false;
    const app = new Application();

    const safeDestroy = () => {
      if (tornDown) return;
      tornDown = true;
      appRef.current = null;
      setPixiReady(false);
      try {
        if (app.renderer) {
          app.canvas?.remove();
          app.destroy(true, true);
        }
      } catch {
        /* Pixi teardown may throw if called twice; ignore */
      }
    };

    void (async () => {
      try {
        await app.init({
          resizeTo: container,
          background: 0x0d0d0f,
          antialias: true,
        });
      } catch {
        return;
      }
      if (disposed) {
        safeDestroy();
        return;
      }
      container.appendChild(app.canvas);
      appRef.current = app;
      setPixiReady(true);
    })();

    return () => {
      disposed = true;
      if (appRef.current === app) {
        safeDestroy();
      }
      // If init is still in flight, the async continuation calls safeDestroy when disposed.
    };
  }, []);

  // Render when chart or playback updates — always read `appRef.current` (never a stale Application).
  useEffect(() => {
    if (!chart || !pixiReady) return;

    const paint = () => {
      const app = appRef.current;
      if (!app?.renderer) return;
      const state = useGameStore.getState();
      const pos = state.playback?.positionMs ?? 0;
      if (state.phase !== "autoplay" && state.phase !== "manual") return;

      renderFrame(app, chart.notes, pos, app.screen.width, app.screen.height);
    };

    paint();
    return useGameStore.subscribe(paint);
  }, [chart, pixiReady]);

  return (
    <div
      ref={canvasRef}
      style={{ flex: 1, width: "100%", position: "relative" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Pure render function (no React, runs inside PixiJS ticker via subscribe)
// ---------------------------------------------------------------------------

function renderFrame(
  app: Application,
  notes: Array<{ timeMs: number; lane: number; durationMs: number }>,
  positionMs: number,
  width: number,
  height: number
): void {
  if (!app.stage) return;

  // Clear stage
  app.stage.removeChildren();

  const laneWidth = width / LANE_COUNT;
  const hitLineY = height * HIT_LINE_Y_FRACTION;
  const lookAheadMs = 2000; // notes this far ahead are visible
  const pxPerMs = hitLineY / lookAheadMs;

  // Draw lane dividers
  const lanes = new Graphics();
  for (let i = 1; i < LANE_COUNT; i++) {
    lanes
      .moveTo(i * laneWidth, 0)
      .lineTo(i * laneWidth, height)
      .stroke({ width: 1, color: 0x222228 });
  }
  app.stage.addChild(lanes);

  // Draw hit line
  const hitLine = new Graphics();
  hitLine
    .moveTo(0, hitLineY)
    .lineTo(width, hitLineY)
    .stroke({ width: 2, color: 0x444448 });
  app.stage.addChild(hitLine);

  // Draw lane hit zones (hollow circles)
  for (let i = 0; i < LANE_COUNT; i++) {
    const cx = i * laneWidth + laneWidth / 2;
    const zone = new Graphics();
    zone
      .circle(cx, hitLineY, NOTE_RADIUS + 2)
      .stroke({ width: 2, color: LANE_COLORS[i] ?? 0xffffff });
    app.stage.addChild(zone);
  }

  // Draw notes
  for (const note of notes) {
    const timeUntil = note.timeMs - positionMs;
    if (timeUntil < -200 || timeUntil > lookAheadMs) continue;

    const cx = note.lane * laneWidth + laneWidth / 2;
    const cy = hitLineY - timeUntil * pxPerMs;
    const color = LANE_COLORS[note.lane] ?? 0xffffff;

    const circle = new Graphics();
    circle.circle(cx, cy, NOTE_RADIUS).fill({ color });
    app.stage.addChild(circle);
  }

  // Draw mode indicator
  const state = useGameStore.getState();
  const modeLabel = state.phase === "autoplay" ? "AUTO" : "PLAY";
  const modeStyle = new TextStyle({
    fontSize: 10,
    fill: state.phase === "autoplay" ? 0x888888 : 0x1db954,
    fontFamily: "Inter, system-ui, sans-serif",
  });
  const modeText = new Text({ text: modeLabel, style: modeStyle });
  modeText.position.set(4, height - 18);
  app.stage.addChild(modeText);
}
