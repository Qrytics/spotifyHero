import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGameStore } from "../store/gameStore.js";

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * HUD – track info and score (mode/keybind/settings control lives in PlayBottomBar).
 */
export function HUD(): React.ReactElement {
  const score = useGameStore((s) => s.score);
  const combo = useGameStore((s) => s.combo);
  const comboMilestoneSeq = useGameStore((s) => s.comboMilestoneSeq);
  const comboBreakSeq = useGameStore((s) => s.comboBreakSeq);
  const playback = useGameStore((s) => s.playback);

  const trackName = playback?.track?.name ?? "—";
  const artist = playback?.track?.artists.join(", ") ?? "";
  const albumArt = playback?.track?.albumArt ?? null;
  const trackId = playback?.track?.id ?? playback?.trackId ?? null;
  const spotifyUrl = trackId ? `https://open.spotify.com/track/${trackId}` : null;

  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  const titleMeasureRef = useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);
  const [comboMilestoneFx, setComboMilestoneFx] = useState(false);
  const [comboBreakFx, setComboBreakFx] = useState(false);

  const measureTruncation = (): void => {
    const el = titleMeasureRef.current;
    if (!el) return;
    setIsTruncated(el.scrollWidth > el.clientWidth + 0.5);
  };

  useLayoutEffect(() => {
    measureTruncation();
  }, [trackName]);

  useEffect(() => {
    const el = titleMeasureRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measureTruncation());
    ro.observe(el);
    return () => ro.disconnect();
  }, [trackName]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (comboMilestoneSeq <= 0) return;
    setComboMilestoneFx(false);
    const id = window.setTimeout(() => setComboMilestoneFx(true), 0);
    const end = window.setTimeout(() => setComboMilestoneFx(false), 340);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(end);
    };
  }, [comboMilestoneSeq]);

  useEffect(() => {
    if (comboBreakSeq <= 0) return;
    setComboBreakFx(false);
    const id = window.setTimeout(() => setComboBreakFx(true), 0);
    const end = window.setTimeout(() => setComboBreakFx(false), 260);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(end);
    };
  }, [comboBreakSeq]);

  const showExpandedTitle = isTruncated && (titleHovered || titleFocused);
  const comboColor =
    combo >= 100 ? "#ff4a4a" : combo >= 50 ? "#ff8a3d" : combo >= 25 ? "#ffd65f" : "var(--accent)";

  const onCopyLink = (): void => {
    if (!spotifyUrl) return;
    void copyTextToClipboard(spotifyUrl).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1600);
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "1.5px 10px 1.5px 1.5px",
        background: "var(--surface)",
        borderBottom: "1px solid #222",
        gap: "2px",
      }}
    >
      <style>{`
        @keyframes comboMilestoneBounce {
          0% { transform: scale(1) rotate(0deg); }
          30% { transform: scale(1.2) rotate(-2deg); }
          60% { transform: scale(0.94) rotate(1.5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes comboBreakShake {
          0% { transform: translateX(0px); opacity: 1; }
          20% { transform: translateX(-3px); opacity: 1; }
          40% { transform: translateX(3px); opacity: 1; }
          60% { transform: translateX(-2px); opacity: 0.95; }
          100% { transform: translateX(0px); opacity: 1; }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "stretch",
          gap: "8px",
        }}
      >
        {albumArt ? (
          <img
            src={albumArt}
            alt={`${trackName} album cover`}
            style={{
              width: 30,
              height: "100%",
              minHeight: 30,
              borderRadius: 6,
              objectFit: "cover",
              border: "1px solid rgba(255,255,255,0.18)",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: 30,
              height: "100%",
              minHeight: 30,
              borderRadius: 6,
              background: "linear-gradient(180deg, #2a2a34 0%, #1b1b24 100%)",
              border: "1px solid rgba(255,255,255,0.15)",
              flexShrink: 0,
            }}
          />
        )}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            marginLeft: "-6px",
            position: "relative",
            overflow: "visible",
          }}
        >
          {copied ? (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: "2px",
                zIndex: 25,
                fontSize: "8px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: "#0d0f0d",
                background: "var(--accent)",
                padding: "3px 7px",
                borderRadius: "4px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                pointerEvents: "none",
              }}
            >
              Copied
            </div>
          ) : null}
          <button
            type="button"
            aria-label={spotifyUrl ? "Copy Spotify link for this song" : undefined}
            disabled={!spotifyUrl}
            onClick={onCopyLink}
            onMouseEnter={() => setTitleHovered(true)}
            onMouseLeave={() => setTitleHovered(false)}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            style={{
              display: "block",
              width: "100%",
              margin: 0,
              padding: 0,
              border: "none",
              background: "transparent",
              textAlign: "left",
              cursor: spotifyUrl ? "pointer" : "default",
              position: "relative",
              overflow: "visible",
            }}
          >
            <div
              ref={titleMeasureRef}
              style={{
                fontSize: "10px",
                fontWeight: 700,
                lineHeight: 1.25,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "var(--text)",
                visibility: showExpandedTitle ? "hidden" : "visible",
              }}
              aria-hidden={showExpandedTitle}
            >
              {trackName}
            </div>
            {showExpandedTitle ? (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  minWidth: "100%",
                  width: "max-content",
                  zIndex: 12,
                  fontSize: "10px",
                  fontWeight: 700,
                  lineHeight: 1.25,
                  whiteSpace: "nowrap",
                  color: "var(--text)",
                  background: "var(--surface)",
                  pointerEvents: "none",
                }}
              >
                {trackName}
              </div>
            ) : null}
          </button>
          <div
            style={{
              fontSize: "9px",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {artist}
          </div>
        </div>
        <div
          style={{
            textAlign: "right",
            flexShrink: 0,
            minWidth: "fit-content",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 800,
              color: "var(--text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {score.toLocaleString()}
          </div>
          {/* Fixed box so combo show/hide does not resize HUD / chart area */}
          <div
            style={{
              fontSize: "9px",
              color: comboBreakFx && combo <= 1 ? "#ff5252" : comboColor,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.25,
              minHeight: "1.25em",
              minWidth: "11ch",
              whiteSpace: "nowrap",
              visibility: combo > 1 ? "visible" : "hidden",
              animation:
                combo > 1
                  ? `${comboMilestoneFx ? "comboMilestoneBounce 300ms ease-out" : "none"}`
                  : `${comboBreakFx ? "comboBreakShake 220ms ease-out" : "none"}`,
            }}
            aria-live="polite"
          >
            {combo > 1 ? `×${combo} COMBO` : "\u00a0"}
          </div>
        </div>
      </div>
    </div>
  );
}
