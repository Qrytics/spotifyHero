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
  const playback = useGameStore((s) => s.playback);

  const trackName = playback?.track?.name ?? "—";
  const artist = playback?.track?.artists.join(", ") ?? "";
  const trackId = playback?.track?.id ?? playback?.trackId ?? null;
  const spotifyUrl = trackId ? `https://open.spotify.com/track/${trackId}` : null;

  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  const titleMeasureRef = useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);
  const [titleFocused, setTitleFocused] = useState(false);

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

  const showExpandedTitle = isTruncated && (titleHovered || titleFocused);

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
        padding: "8px 10px 6px",
        background: "var(--surface)",
        borderBottom: "1px solid #222",
        gap: "4px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "6px",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
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
              color: "var(--accent)",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.25,
              minHeight: "1.25em",
              minWidth: "11ch",
              whiteSpace: "nowrap",
              visibility: combo > 1 ? "visible" : "hidden",
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
