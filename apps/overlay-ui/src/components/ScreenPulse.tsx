import React, { useCallback, useEffect, useRef, useState } from "react";
import { useGameStore } from "../store/gameStore.js";
import { onScreenPulse, type ScreenPulseDetail } from "../lib/screenPulse.js";
import { countInPending } from "../lib/countIn.js";

/**
 * The big word that flashes over the middle of the highway and fades — play mode
 * (AUTO / MANUAL / PAUSED) and volume changes.
 *
 * Replaces the permanent mode chip that used to sit in `PlayBottomBar`: mode is
 * something you need to *notice when it changes*, not read continuously, and the
 * bar has no room to spare at the 180 px minimum window width.
 *
 * Mode is derived from `phase` here instead of being dispatched by whoever
 * changed it, so the keybind, the transport buttons and a Spotify pause poll all
 * pulse identically. Other messages arrive as `pulseScreen()` events.
 *
 * The animation is pure CSS (`.sh-pulse` in `global.css`) and the element is
 * remounted on each pulse via `key={seq}`, which is what restarts it mid-flight
 * when pulses land back-to-back. `onAnimationEnd` unmounts the layer, so nothing
 * renders while the screen is quiet.
 */
export function ScreenPulse(): React.ReactElement | null {
  const phase = useGameStore((s) => s.phase);
  const [pulse, setPulse] = useState<(ScreenPulseDetail & { seq: number }) | null>(
    null
  );
  const seqRef = useRef(0);

  const show = useCallback((detail: ScreenPulseDetail): void => {
    seqRef.current += 1;
    setPulse({ ...detail, seq: seqRef.current });
  }, []);

  // Fires on mount too, which is wanted: a chart appearing pulses the mode it
  // started in.
  useEffect(() => {
    // …unless a count-in is about to claim the middle of the screen. This mount
    // effect runs *before* the parent's effect starts the count-in (children
    // first), so `countInPending()` is still true here — which is exactly the
    // one-frame "AUTO" flash under the "3" we want to skip.
    if (countInPending()) return;
    if (phase === "autoplay") show({ text: "AUTO" });
    else if (phase === "manual") show({ text: "MANUAL", tone: "accent" });
    else if (phase === "paused") show({ text: "PAUSED", tone: "warn" });
  }, [phase, show]);

  useEffect(() => onScreenPulse(show), [show]);

  if (!pulse) return null;

  const color =
    pulse.tone === "accent"
      ? "var(--accent)"
      : pulse.tone === "warn"
        ? "#ffb74d"
        : "#e6e8f2";

  return (
    <div className="sh-pulse-layer" role="status" aria-live="polite">
      <div
        key={pulse.seq}
        className="sh-pulse"
        style={{ color, fontSize: pulseFontSize(pulse.text, pulse.size) }}
        onAnimationEnd={() => {
          // Guard against a stale element's event clearing a newer pulse.
          setPulse((current) =>
            current && current.seq === pulse.seq ? null : current
          );
        }}
      >
        <span>{pulse.text}</span>
        {pulse.bar !== undefined ? (
          <div className="sh-pulse-bar">
            <div
              style={{ width: `${Math.round(Math.min(1, Math.max(0, pulse.bar)) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Size down for longer text instead of wrapping a 30 px word inside a 180 px
 * window. `MANUAL` (6) is the longest of the mode words and stays at full size.
 *
 * `xl` is the count-in ("3", "GO!") — short by construction, so it can be huge
 * even in the narrowest window.
 */
function pulseFontSize(text: string, size?: "md" | "xl"): string {
  if (size === "xl") return text.length <= 3 ? "64px" : "40px";
  if (text.length <= 7) return "30px";
  if (text.length <= 12) return "18px";
  return "12px";
}
