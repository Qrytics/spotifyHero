import React, { useRef, useEffect, useState } from "react";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Note } from "@spotifyhero/shared-types";
import { useGameStore } from "../store/gameStore.js";

const LANE_COLORS = [0xe040fb, 0x1db954, 0xff9800, 0x2196f3];
const LANE_COUNT = 4;
const NOTE_RADIUS = 15;
const HIT_LINE_Y_FRACTION = 0.82;

const PLAYABLE_PHASES = new Set(["autoplay", "manual", "paused"]);

/**
 * NoteHighway — PixiJS lanes + falling notes.
 *
 * Performance: static geometry (lanes, hit line, receptors) is redrawn only when size or
 * track changes. Notes are batched into **one** Graphics via `clear()` per frame — no
 * per-note `new Graphics()` (that pattern tanked FPS to ~1).
 */
export function NoteHighway(): React.ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const chart = useGameStore((s) => s.chart);
  const [pixiReady, setPixiReady] = useState(false);

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
        /* ignore */
      }
    };

    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;

    void (async () => {
      try {
        await app.init({
          resizeTo: container,
          background: 0x0a0a12,
          antialias: true,
          autoDensity: true,
          powerPreference: "high-performance",
          resolution: dpr,
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
    };
  }, []);

  useEffect(() => {
    if (!chart || !pixiReady) return;
    const app = appRef.current;
    if (!app?.renderer || !app.stage) return;

    const root = new Container();
    app.stage.removeChildren();
    app.stage.addChild(root);

    const staticG = new Graphics();
    const notesG = new Graphics();
    const modeText = new Text({
      text: "",
      style: new TextStyle({
        fontSize: 11,
        fill: 0x777788,
        fontFamily: "system-ui, Segoe UI, sans-serif",
        fontWeight: "600",
      }),
    });
    root.addChild(staticG);
    root.addChild(notesG);
    root.addChild(modeText);

    let lastStaticKey = "";
    let lastModeLabel = "";

    const tick = (): void => {
      const state = useGameStore.getState();
      if (!PLAYABLE_PHASES.has(state.phase)) return;
      const c = state.chart;
      if (!c) return;

      const pos = state.playback?.positionMs ?? 0;
      let w = Math.max(2, Math.floor(app.screen.width));
      let h = Math.max(2, Math.floor(app.screen.height));
      const el = canvasRef.current;
      if (el && (w < 4 || h < 4)) {
        w = Math.max(2, Math.floor(el.clientWidth));
        h = Math.max(2, Math.floor(el.clientHeight));
      }
      if (w < 4 || h < 4) return;

      const staticKey = `${w}x${h}-${c.trackId}`;
      if (staticKey !== lastStaticKey) {
        lastStaticKey = staticKey;
        drawStaticLayer(staticG, w, h);
      }

      drawNotesLayer(notesG, c.notes ?? [], pos, w, h);

      const modeLabel =
        state.phase === "manual"
          ? "MANUAL"
          : state.phase === "paused"
            ? "PAUSED"
            : "AUTO";
      if (modeLabel !== lastModeLabel) {
        lastModeLabel = modeLabel;
        modeText.text = modeLabel;
        modeText.style.fill =
          state.phase === "manual"
            ? 0x1db954
            : state.phase === "paused"
              ? 0xff9800
              : 0x777788;
      }
      modeText.position.set(8, h - 22);
    };

    app.ticker.add(tick);
    tick();

    return () => {
      app.ticker.remove(tick);
      app.stage?.removeChildren();
    };
  }, [chart, pixiReady]);

  return (
    <div
      ref={canvasRef}
      style={{
        flex: 1,
        width: "100%",
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
      }}
    />
  );
}

function drawStaticLayer(g: Graphics, width: number, height: number): void {
  g.clear();
  const laneWidth = width / LANE_COUNT;
  const hitLineY = height * HIT_LINE_Y_FRACTION;

  g.rect(0, 0, width, height).fill({ color: 0x06060c, alpha: 1 });
  for (let i = 0; i < LANE_COUNT; i++) {
    const x = i * laneWidth;
    g.rect(x, 0, laneWidth, height).fill({
      color: LANE_COLORS[i] ?? 0xffffff,
      alpha: 0.08,
    });
  }
  for (let i = 1; i < LANE_COUNT; i++) {
    const x = i * laneWidth;
    g.rect(x - 0.5, 0, 1, height).fill({ color: 0x4a4a5c, alpha: 0.85 });
  }
  g.rect(0, hitLineY - 4, width, 8).fill({ color: 0x1db954, alpha: 0.14 });
  g.rect(0, hitLineY - 1.5, width, 3).fill({ color: 0x9a9ab0, alpha: 1 });

  for (let i = 0; i < LANE_COUNT; i++) {
    const cx = i * laneWidth + laneWidth / 2;
    g.circle(cx, hitLineY, NOTE_RADIUS + 5).fill({ color: 0x000000, alpha: 0.35 });
    g.circle(cx, hitLineY, NOTE_RADIUS + 2).stroke({
      width: 2,
      color: LANE_COLORS[i] ?? 0xffffff,
      alpha: 0.9,
    });
  }
}

function drawNotesLayer(
  g: Graphics,
  notes: Note[],
  positionMs: number,
  width: number,
  height: number
): void {
  g.clear();
  const laneWidth = width / LANE_COUNT;
  const hitLineY = height * HIT_LINE_Y_FRACTION;
  const lookAheadMs = 2200;
  const pxPerMs = hitLineY / lookAheadMs;

  const visible = notes
    .map((n) => ({ n, timeUntil: n.timeMs - positionMs }))
    .filter(({ timeUntil }) => timeUntil > -400 && timeUntil < lookAheadMs)
    .sort((a, b) => b.timeUntil - a.timeUntil);

  for (const { n: note, timeUntil } of visible) {
    const cx = note.lane * laneWidth + laneWidth / 2;
    const cy = hitLineY - timeUntil * pxPerMs;
    const color = LANE_COLORS[note.lane] ?? 0xffffff;
    const pulse = Math.min(1, Math.max(0, 1 - Math.abs(timeUntil) / 900));

    g.circle(cx, cy, NOTE_RADIUS + 5 + pulse * 3).fill({
      color,
      alpha: 0.14 + pulse * 0.1,
    });
    g.circle(cx, cy, NOTE_RADIUS).fill({ color, alpha: 1 });
    g.circle(cx, cy, NOTE_RADIUS).stroke({
      width: 2,
      color: 0xffffff,
      alpha: 0.4,
    });
  }
}
