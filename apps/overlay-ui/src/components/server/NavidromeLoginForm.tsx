import React, { useRef, useState } from "react";

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
  const [missing, setMissing] = useState<string | null>(null);

  // WKWebView keychain autofill can write an input's value without firing React's
  // change event, which left state empty while the field looked filled — and with
  // Connect disabled on that state there was no way out of the form. So the button
  // is only disabled while a request is in flight, and submit reads the DOM values,
  // which are authoritative for what the user can actually see.
  const serverRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const server = (serverRef.current?.value ?? serverUrl).trim();
        const user = (usernameRef.current?.value ?? username).trim();
        // Never trimmed: trailing space can be part of a password.
        const pass = passwordRef.current?.value ?? password;

        const blank = [
          ...(server === "" ? ["Server"] : []),
          ...(user === "" ? ["Username"] : []),
          ...(pass === "" ? ["Password"] : []),
        ];
        if (blank.length > 0) {
          setMissing(
            blank.length === 3
              ? "Fill in all three fields."
              : `Still needed: ${blank.join(", ")}.`,
          );
          return;
        }

        setMissing(null);
        onSubmit(server, user, pass);
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
            ref={serverRef}
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
            ref={usernameRef}
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
            ref={passwordRef}
            className="sh-lib-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {missing && !error && (
          <div style={{ fontSize: "8px", color: "#ffc46b", lineHeight: 1.35 }}>
            {missing}
          </div>
        )}
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
          disabled={busy}
          style={{
            flex: 1,
            padding: "6px 9px",
            fontSize: "10px",
            fontWeight: 700,
            borderRadius: "5px",
            border: "none",
            background: busy ? "#2a2a34" : "var(--accent-library)",
            color: busy ? "#666" : "#0d0d0f",
            cursor: busy ? "wait" : "pointer",
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
