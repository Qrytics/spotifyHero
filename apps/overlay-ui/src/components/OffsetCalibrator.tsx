import React, { useCallback, useEffect, useRef, useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import {
  eventMatchesPlayKey,
  formatKeybindLabel,
} from "../lib/keybindDisplay.js";
import { playbackClock } from "../lib/playbackClock.js";
import {
  computePlaybackTimingOffsetFromTaps,
} from "../lib/offsetCalibration.js";

type Step = "intro" | "lanes" | "beat" | "result";

/** Match `NoteHighway` canvas layout (CSS px) — keep in sync with gameplay. */
const LANE_COUNT = 4;
const NOTE_RADIUS = 15;
const HIT_LINE_BOTTOM_PAD = 4;
const HIT_TARGET_OUTER_R = NOTE_RADIUS + 5;
const RECEPTOR_RING_R = NOTE_RADIUS + 2;

function hitLineYFromHeight(height: number): number {
  return height - HIT_TARGET_OUTER_R - HIT_LINE_BOTTOM_PAD;
}

function yFromTime(
  hitLineY: number,
  pxPerMs: number,
  noteTimeMs: number,
  positionMs: number
): number {
  return hitLineY - (noteTimeMs - positionMs) * pxPerMs;
}

/** Virtual scroll matches gameplay lookahead so the gem centers on receptors at hit time. */
const LANE_TRAVEL_MS = 2200;
/** After the hit window passes, loop restarts automatically (no dead state). */
const LANE_CYCLE_GAP_MS = 950;
const LANE_HIT_WINDOW_MS = 220;
const BEAT_TAPS = 8;

const LANE_HEX = ["#BF5FFF", "#00E5FF", "#FF6B35", "#39FF14"] as const;

function laneCycleMs(): number {
  return LANE_TRAVEL_MS + LANE_CYCLE_GAP_MS;
}

/** Elapsed within current loop; hit window centers on LANE_TRAVEL_MS. */
function phaseInCycle(elapsed: number): number {
  const c = laneCycleMs();
  return ((elapsed % c) + c) % c;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function OffsetCalibrator({ open, onClose }: Props): React.ReactElement | null {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const playback = useGameStore((s) => s.playback);

  const [step, setStep] = useState<Step>("intro");
  const [laneStep, setLaneStep] = useState(0);
  /** Monotonic clock for lane animation — never reset on laneStep (avoids transition glitches). */
  const [laneNow, setLaneNow] = useState(() => performance.now());
  /** Only set when starting lanes / advancing lane / manual restart — not in an effect tied to laneStep. */
  const laneSequenceEpochRef = useRef(performance.now());
  const [beatTaps, setBeatTaps] = useState<number[]>([]);
  const beatTapsRef = useRef<number[]>([]);
  const [computedOffset, setComputedOffset] = useState(0);
  const [visualOffsetDraft, setVisualOffsetDraft] = useState(0);
  const [wrongKeyFlash, setWrongKeyFlash] = useState(false);
  const [beatPulse, setBeatPulse] = useState(0);

  const beginLaneNote = useCallback(() => {
    laneSequenceEpochRef.current = performance.now();
  }, []);

  useEffect(() => {
    if (!open) return;
    useGameStore.getState().setCalibrationActive(true);
    setStep("intro");
    setLaneStep(0);
    beatTapsRef.current = [];
    setBeatTaps([]);
    setComputedOffset(0);
    setVisualOffsetDraft(settings.visualNoteOffsetMs);
    beginLaneNote();
    return () => {
      useGameStore.getState().setCalibrationActive(false);
    };
  }, [open, beginLaneNote, settings.visualNoteOffsetMs]);

  useEffect(() => {
    if (step === "beat") {
      beatTapsRef.current = [];
      setBeatTaps([]);
    }
  }, [step]);

  useEffect(() => {
    if (!open || step !== "lanes") return;
    let id = 0;
    const loop = () => {
      setLaneNow(performance.now());
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [open, step]);

  const onLaneKey = useCallback(
    (e: KeyboardEvent) => {
      if (!open || step !== "lanes") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, button")) return;

      const key = e.key.toLowerCase();
      const want = settings.laneKeys[laneStep]?.toLowerCase() ?? "";
      if (key !== want) {
        if (settings.laneKeys.some((k) => k.toLowerCase() === key)) {
          setWrongKeyFlash(true);
          window.setTimeout(() => setWrongKeyFlash(false), 180);
        }
        return;
      }

      const elapsed = performance.now() - laneSequenceEpochRef.current;
      const te = phaseInCycle(elapsed);
      if (Math.abs(te - LANE_TRAVEL_MS) <= LANE_HIT_WINDOW_MS) {
        e.preventDefault();
        e.stopPropagation();
        if (laneStep >= 3) {
          setStep("beat");
        } else {
          setLaneStep((s) => s + 1);
          beginLaneNote();
        }
      }
    },
    [open, step, laneStep, settings.laneKeys, beginLaneNote]
  );

  useEffect(() => {
    window.addEventListener("keydown", onLaneKey, true);
    return () => window.removeEventListener("keydown", onLaneKey, true);
  }, [onLaneKey]);

  const onBeatKey = useCallback(
    (e: KeyboardEvent) => {
      if (!open || step !== "beat") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, button")) return;
      if (!eventMatchesPlayKey(e, settings.playKeybind)) return;

      const pb = useGameStore.getState().playback;
      if (!pb?.isPlaying || !pb.trackId) return;

      e.preventDefault();
      e.stopPropagation();

      if (beatTapsRef.current.length >= BEAT_TAPS) return;

      setBeatPulse((n) => n + 1);

      const pos = playbackClock.estimateMs();
      beatTapsRef.current.push(pos);
      setBeatTaps([...beatTapsRef.current]);

      if (beatTapsRef.current.length >= BEAT_TAPS) {
        const bpm = pb.track?.bpm ?? 120;
        const beatMs = 60_000 / Math.max(40, Math.min(300, bpm));
        const off = computePlaybackTimingOffsetFromTaps(beatTapsRef.current, beatMs);
        setComputedOffset(off);
        setStep("result");
      }
    },
    [open, step, settings.playKeybind]
  );

  useEffect(() => {
    window.addEventListener("keydown", onBeatKey, true);
    return () => window.removeEventListener("keydown", onBeatKey, true);
  }, [onBeatKey]);

  if (!open) return null;

  const elapsedLane = laneNow - laneSequenceEpochRef.current;
  const te = step === "lanes" ? phaseInCycle(elapsedLane) : 0;
  const inHitWindow =
    step === "lanes" && Math.abs(te - LANE_TRAVEL_MS) <= LANE_HIT_WINDOW_MS;
  const bpm = playback?.track?.bpm ?? 120;

  return (
    <div
      data-calibrator
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "12px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "340px",
          background: "var(--surface)",
          borderRadius: "10px",
          border: "1px solid #2a2a32",
          padding: "14px",
          color: "var(--text)",
        }}
      >
        {step === "intro" && (
          <>
            <h2 style={{ fontSize: "14px", margin: "0 0 8px", fontWeight: 700 }}>
              Timing calibration
            </h2>
            <ol
              style={{
                fontSize: "10px",
                lineHeight: 1.5,
                margin: "0 0 12px",
                paddingLeft: "18px",
                color: "var(--text-muted)",
              }}
            >
              <li>
                Hit four notes when the <strong style={{ color: "var(--text)" }}>note circle</strong> is centered on the{" "}
                <strong style={{ color: "var(--text)" }}>receptor</strong> — stacked on the white hit line, same as the main highway (same lane keys). Missed notes repeat automatically.
              </li>
              <li>
                Then tap <strong style={{ color: "var(--text)" }}>{formatKeybindLabel(settings.playKeybind)}</strong> on each <strong style={{ color: "var(--text)" }}>strong beat</strong> while Spotify is playing — {BEAT_TAPS} taps.
              </li>
            </ol>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #444",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  setLaneStep(0);
                  beginLaneNote();
                  setStep("lanes");
                }}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--accent)",
                  color: "#0d0d0f",
                  fontWeight: 700,
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Start
              </button>
            </div>
          </>
        )}

        {step === "lanes" && (
          <>
            <p
              style={{
                fontSize: "11px",
                margin: "0 0 10px",
                lineHeight: 1.45,
                minHeight: "44px",
                transition: "opacity 0.12s ease",
                opacity: wrongKeyFlash ? 0.65 : 1,
              }}
            >
              Press{" "}
              <strong style={{ color: LANE_HEX[laneStep] ?? "#fff" }}>
                {formatKeybindLabel(settings.laneKeys[laneStep] ?? "?")}
              </strong>{" "}
              when the note sits on the receptor (circles aligned on the white bar) —{" "}
              <span style={{ color: "var(--text-muted)" }}>
                {laneStep + 1} / 4
              </span>{" "}
              <span
                aria-hidden={!inHitWindow}
                style={{
                  display: "inline-block",
                  marginLeft: "6px",
                  fontSize: "10px",
                  fontWeight: 600,
                  minWidth: "7.5ch",
                  color: "#1ed760",
                  visibility: inHitWindow ? "visible" : "hidden",
                }}
              >
                Hit now
              </span>
            </p>
            <CalibrationGameplayStrip
              laneStep={laneStep}
              teMs={te}
            />
            <p style={{ fontSize: "8px", color: "#666", margin: "0 0 8px", lineHeight: 1.35 }}>
              If you miss, the note loops — tap when the moving note overlaps the target, like gameplay.
            </p>
            <button
              type="button"
              onClick={() => setStep("intro")}
              style={{
                width: "100%",
                padding: "6px",
                fontSize: "10px",
                borderRadius: "6px",
                border: "1px solid #444",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              Back
            </button>
          </>
        )}

        {step === "beat" && (
          <>
            <p style={{ fontSize: "11px", margin: "0 0 8px", lineHeight: 1.45 }}>
              Play music in Spotify. Tap{" "}
              <strong>{formatKeybindLabel(settings.playKeybind)}</strong> on each beat —{" "}
              <strong>{beatTaps.length}</strong> / {BEAT_TAPS}. Tempo ~{Math.round(bpm)} BPM.
            </p>
            {!playback?.isPlaying && (
              <p style={{ fontSize: "10px", color: "#ff9800", margin: "0 0 8px" }}>
                Start playback in Spotify first.
              </p>
            )}
            <div
              style={{
                position: "relative",
                height: "8px",
                borderRadius: "4px",
                background: "#2a2a32",
                overflow: "hidden",
                marginBottom: "10px",
              }}
            >
              <div
                style={{
                  width: `${(beatTaps.length / BEAT_TAPS) * 100}%`,
                  height: "100%",
                  background: "var(--accent)",
                  transition: "width 0.12s ease",
                }}
              />
              {beatPulse > 0 && (
                <div
                  key={beatPulse}
                  style={{
                    position: "absolute",
                    right: `${(beatTaps.length / BEAT_TAPS) * 100}%`,
                    top: "50%",
                    width: "14px",
                    height: "14px",
                    marginTop: "-7px",
                    marginRight: "-7px",
                    borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.85)",
                    animation: "calBeatPulse 0.45s ease-out forwards",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
            <style>{`
              @keyframes calBeatPulse {
                0% { transform: scale(0.6); opacity: 1; }
                100% { transform: scale(2.2); opacity: 0; }
              }
            `}</style>
            <button
              type="button"
              onClick={() => {
                setLaneStep(0);
                beginLaneNote();
                setStep("lanes");
              }}
              style={{
                width: "100%",
                padding: "6px",
                fontSize: "10px",
                borderRadius: "6px",
                border: "1px solid #444",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              Back
            </button>
          </>
        )}

        {step === "result" && (
          <>
            <p style={{ fontSize: "11px", margin: "0 0 8px" }}>
              Suggested offset:{" "}
              <strong>
                {computedOffset >= 0 ? "+" : ""}
                {computedOffset} ms
              </strong>
            </p>
            <p
              style={{
                fontSize: "9px",
                color: "var(--text-muted)",
                lineHeight: 1.4,
                margin: "0 0 12px",
              }}
            >
              This shifts chart timing vs Spotify&apos;s reported position. You can fine-tune in
              Settings. Visual note offset is separate and does not change scoring.
            </p>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "9px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                Visual note offset (ms)
              </label>
              <input
                type="range"
                min={-250}
                max={250}
                step={5}
                value={visualOffsetDraft}
                onChange={(e) => setVisualOffsetDraft(Number.parseInt(e.target.value, 10))}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => {
                  updateSettings({
                    playbackTimingOffsetMs: computedOffset,
                    visualNoteOffsetMs: visualOffsetDraft,
                  });
                  onClose();
                }}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--accent)",
                  color: "#0d0d0f",
                  fontWeight: 700,
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                Apply and close
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "8px 10px",
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
          </>
        )}
      </div>
    </div>
  );
}

/** Fixed height so hit-line math matches `NoteHighway` (see `paintStatic`). */
const CAL_HIGHWAY_H = 196;

type GameplayStripProps = {
  laneStep: number;
  /** Elapsed ms in lane cycle; gem centers on receptors when `teMs === LANE_TRAVEL_MS`. */
  teMs: number;
};

/**
 * One-row highway: lane tints, full-width green + silver hit bars, receptors — same stack as gameplay.
 * Gem motion uses `yFromTime` with the same scroll rate as the main chart (`hitLineY / LANE_TRAVEL_MS`).
 */
function CalibrationGameplayStrip({ laneStep, teMs }: GameplayStripProps): React.ReactElement {
  const hitLineY = hitLineYFromHeight(CAL_HIGHWAY_H);
  const pxPerMs = hitLineY / LANE_TRAVEL_MS;
  const cy = yFromTime(hitLineY, pxPerMs, LANE_TRAVEL_MS, teMs);
  const hex = LANE_HEX[laneStep] ?? "#fff";
  const cxPct = ((laneStep + 0.5) / LANE_COUNT) * 100;

  return (
    <div
      style={{
        width: "100%",
        height: `${CAL_HIGHWAY_H}px`,
        position: "relative",
        borderRadius: "8px",
        overflow: "hidden",
        marginBottom: "10px",
        border: "1px solid #1a1a22",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, #0e0e18 0%, #050508 100%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", pointerEvents: "none" }}>
        {([0, 1, 2, 3] as const).map((i) => (
          <div
            key={`tint-${i}`}
            style={{
              flex: 1,
              background: hexWithAlpha(LANE_HEX[i] ?? "#fff", 0.09),
            }}
          />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <div
          key={`sep-${i}`}
          style={{
            position: "absolute",
            left: `${(i / LANE_COUNT) * 100}%`,
            top: 0,
            width: 1,
            height: "100%",
            marginLeft: -0.5,
            background: "rgba(74,74,92,0.85)",
            pointerEvents: "none",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: hitLineY - 4,
          height: 8,
          background: "rgba(29,185,84,0.16)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: hitLineY - 1.5,
          height: 3,
          background: "rgba(154,154,176,1)",
          pointerEvents: "none",
        }}
      />
      {([0, 1, 2, 3] as const).map((lane) => {
        const hex = LANE_HEX[lane] ?? "#fff";
        const active = lane === laneStep;
        return (
          <div
            key={`rec-${lane}`}
            style={{
              position: "absolute",
              left: `${((lane + 0.5) / LANE_COUNT) * 100}%`,
              top: hitLineY,
              width: HIT_TARGET_OUTER_R * 2,
              height: HIT_TARGET_OUTER_R * 2,
              marginLeft: -HIT_TARGET_OUTER_R,
              marginTop: -HIT_TARGET_OUTER_R,
              pointerEvents: "none",
              opacity: active ? 1 : 0.55,
              transition: "opacity 0.12s ease",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: HIT_TARGET_OUTER_R * 2,
                height: HIT_TARGET_OUTER_R * 2,
                marginLeft: -HIT_TARGET_OUTER_R,
                marginTop: -HIT_TARGET_OUTER_R,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.38)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: RECEPTOR_RING_R * 2,
                height: RECEPTOR_RING_R * 2,
                marginLeft: -RECEPTOR_RING_R,
                marginTop: -RECEPTOR_RING_R,
                borderRadius: "50%",
                border: `2px solid ${hex}`,
                boxSizing: "border-box",
              }}
            />
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: `${cxPct}%`,
          top: cy,
          width: NOTE_RADIUS * 2,
          height: NOTE_RADIUS * 2,
          marginLeft: -NOTE_RADIUS,
          marginTop: -NOTE_RADIUS,
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, ${hex}ff, ${hex}cc)`,
          boxShadow: `0 0 10px ${hex}88, inset 0 -2px 6px rgba(0,0,0,0.35)`,
          border: "2px solid rgba(255,255,255,0.42)",
          pointerEvents: "none",
          willChange: "top",
        }}
      />
    </div>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  const n = hex.replace("#", "");
  const full =
    n.length === 3 ? n.split("").map((c) => c + c).join("") : n.padEnd(6, "0").slice(0, 6);
  const v = parseInt(full, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
