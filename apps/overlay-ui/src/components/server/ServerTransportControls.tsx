import React, { useState } from "react";
import { useGameStore } from "../../store/gameStore.js";
import { activePlaybackSource } from "../../lib/playback/activeSource.js";
import { clearPreparedAudio } from "../../lib/analysis/preparedAudio.js";

/**
 * Transport for music-server mode — the game owns the audio here, so it has to
 * own the controls. Lives inside `PlayBottomBar` and only renders when
 * `playback.source === "server"`.
 *
 * **No scrub bar, deliberately.** Arbitrary seeking would mean silently
 * resolving every note before the new position (otherwise the whole skipped
 * section misses), which is practice mode — a separate feature with its own
 * scoring rules. Restart-from-the-top is the one reposition v1 allows, which is
 * why `capabilities.seek` is `false` for both sources.
 *
 * The 180 px minimum window is the binding constraint: buttons are 15 px glyphs
 * and the volume slider is 30 px.
 */
export function ServerTransportControls(): React.ReactElement {
  const phase = useGameStore((s) => s.phase);
  const volumePercent = useGameStore((s) => s.playback?.volumePercent ?? 100);
  const [busy, setBusy] = useState(false);

  const playing = phase === "autoplay" || phase === "manual";

  const run = (fn: () => Promise<void>): void => {
    if (busy) return;
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        flex: "0 0 auto",
      }}
    >
      <IconButton
        title={playing ? "Pause" : "Play"}
        disabled={busy}
        onClick={() =>
          run(async () => {
            const src = activePlaybackSource();
            if (!src) return;
            await (playing ? src.pause() : src.play());
          })
        }
      >
        {playing ? "❙❙" : "▶"}
      </IconButton>

      <IconButton
        title="Restart from the beginning"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await activePlaybackSource()?.restart();
          })
        }
      >
        ↺
      </IconButton>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={volumePercent}
        title={`Volume ${volumePercent}%`}
        aria-label="Volume"
        onChange={(e) => {
          const pct = Number.parseInt(e.target.value, 10);
          // Not routed through `run`: dragging fires continuously, and
          // `setVolume` is a synchronous gain write with an event after it.
          void activePlaybackSource()?.setVolume(pct / 100);
        }}
        style={{ width: 30, height: 10, flex: "0 0 auto" }}
      />

      <IconButton
        title="Back to library"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const src = activePlaybackSource();
            // `stop()` first so the audio is silent before the UI changes, and
            // `resetRound()` — not `setPlayback({trackId: null})`, which lands in
            // `phase: "paused"` with no track, a dead end.
            src?.stop();
            // The analysis registry is the other holder of the decoded buffer;
            // leaving it set would keep ~92 MB alive across the library screen.
            clearPreparedAudio();
            useGameStore.getState().resetRound();
          })
        }
      >
        ✕
      </IconButton>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: "0 0 auto",
        width: 15,
        height: 15,
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "7px",
        lineHeight: 1,
        borderRadius: "3px",
        border: "1px solid #2c2c38",
        background: "#14141c",
        color: "var(--accent-library, #9b8cff)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
