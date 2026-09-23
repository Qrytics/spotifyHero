import React from "react";
import { useGameStore } from "../../store/gameStore.js";
import { GAME_LOGO_SRC, GAME_TITLE } from "../../lib/branding.js";

/**
 * First-run music source choice, shown when `settings.musicSource === null`.
 *
 * "My Library" (the personal music server) is visually primary — accent border,
 * listed first — because it is the better path: the game owns the audio, so it
 * gets an exact playhead and real onset analysis. Spotify is a muted secondary
 * card.
 *
 * The window is 180 px wide, so the two cards stack vertically.
 */
export function SourcePicker(): React.ReactElement {
  const updateSettings = useGameStore((s) => s.updateSettings);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        padding: "10px 12px 12px",
      }}
    >
      <div
        className="thin-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <img
          src={GAME_LOGO_SRC}
          alt={`${GAME_TITLE} logo`}
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            objectFit: "cover",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        />
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text)" }}>
          {GAME_TITLE}
        </div>
        <div
          style={{
            fontSize: "8.5px",
            color: "var(--text-muted)",
            lineHeight: 1.4,
            textAlign: "center",
          }}
        >
          Where should the music come from?
        </div>

        <SourceCard
          primary
          icon="♪"
          title="MY LIBRARY"
          lines={["Your own music server.", "The game plays the audio."]}
          onClick={() => updateSettings({ musicSource: "server" })}
        />
        <SourceCard
          primary={false}
          icon="▶"
          title="Spotify"
          lines={["Use your own account.", "Press play in Spotify."]}
          onClick={() => updateSettings({ musicSource: "spotify" })}
        />

        <div
          style={{
            fontSize: "7.5px",
            color: "rgba(255,255,255,0.35)",
            lineHeight: 1.35,
            textAlign: "center",
            paddingTop: "2px",
          }}
        >
          You can change this later in Settings.
        </div>
      </div>
    </div>
  );
}

type CardProps = {
  primary: boolean;
  icon: string;
  title: string;
  lines: string[];
  onClick: () => void;
};

function SourceCard({
  primary,
  icon,
  title,
  lines,
  onClick,
}: CardProps): React.ReactElement {
  const accent = primary ? "var(--accent-library)" : "#4a4a58";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        padding: primary ? "9px 10px" : "7px 10px",
        borderRadius: "8px",
        border: `1px solid ${accent}`,
        background: primary
          ? "rgba(124, 92, 255, 0.12)"
          : "rgba(255,255,255,0.03)",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: primary ? "10.5px" : "10px",
          fontWeight: primary ? 700 : 600,
          color: primary ? "var(--accent-library)" : "var(--text)",
          letterSpacing: primary ? "0.04em" : undefined,
        }}
      >
        <span aria-hidden>{icon}</span>
        <span>{title}</span>
      </div>
      {lines.map((l) => (
        <div
          key={l}
          style={{
            fontSize: "8px",
            color: "var(--text-muted)",
            lineHeight: 1.3,
          }}
        >
          {l}
        </div>
      ))}
    </button>
  );
}
