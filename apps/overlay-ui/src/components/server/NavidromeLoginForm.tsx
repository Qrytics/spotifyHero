import React, { useState } from "react";

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (serverUrl: string, username: string, password: string) => void;
  /** Back to the source picker. */
  onBack: () => void;
};

/**
 * In-game Navidrome / Subsonic login.
 *
 * The password never leaves this component: `useNavidromeAuth` immediately
 * derives `md5(password + salt)` and only that is persisted. See the security
 * note in `lib/navidrome/credentials.ts` for what that does and does not buy.
 */
export function NavidromeLoginForm({
  busy,
  error,
  onSubmit,
  onBack,
}: Props): React.ReactElement {
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit =
    !busy && serverUrl.trim() !== "" && username.trim() !== "" && password !== "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit(serverUrl, username, password);
        // Drop the plaintext from component state as soon as it is handed off.
        setPassword("");
      }}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        padding: "10px 12px 12px",
        gap: "6px",
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
          gap: "6px",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: "var(--accent-library)",
          }}
        >
          Connect music server
        </div>
        <div
          style={{ fontSize: "8px", color: "var(--text-muted)", lineHeight: 1.35 }}
        >
          Navidrome / Subsonic. Use a dedicated account if you can — the
          credential is stored on this machine.
        </div>

        <Field label="Server">
          <input
            className="sh-lib-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="music.example.com"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
        </Field>
        <Field label="Username">
          <input
            className="sh-lib-input"
            type="text"
            autoComplete="username"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <input
            className="sh-lib-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error && (
          <div style={{ fontSize: "8px", color: "#ff7c7c", lineHeight: 1.35 }}>
            {error}
          </div>
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          display: "flex",
          gap: "6px",
          paddingTop: "8px",
          borderTop: "1px solid rgba(60,60,70,0.5)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "6px 9px",
            fontSize: "9px",
            borderRadius: "5px",
            border: "1px solid #333",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          ‹ Back
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            flex: 1,
            padding: "6px 9px",
            fontSize: "10px",
            fontWeight: 700,
            borderRadius: "5px",
            border: "none",
            background: canSubmit ? "var(--accent-library)" : "#2a2a34",
            color: canSubmit ? "#0d0d0f" : "#666",
            cursor: busy ? "wait" : canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "8px", color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}
