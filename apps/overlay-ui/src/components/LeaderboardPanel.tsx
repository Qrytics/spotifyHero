import React, { useEffect, useRef, useState } from "react";
import {
  type SupabaseClientConfig,
  SupabaseLeaderboardClient,
} from "@spotifyhero/leaderboard-client";
import type { Difficulty, GameSession, LeaderboardEntry } from "@spotifyhero/shared-types";
import { useGameStore } from "../store/gameStore.js";
import { GAME_LOGO_SRC, GAME_TITLE } from "../lib/branding.js";

type Props = {
  open: boolean;
  onClose: () => void;
  trackId: string;
  difficulty: Difficulty;
  session: GameSession | null;
  eligibleForRanking?: boolean;
};

type LeaderboardData = {
  global: LeaderboardEntry[];
  friends: LeaderboardEntry[];
};

const LEADERBOARD_LIMIT = 8;

/** Turn PostgREST PGRST205 etc. into setup instructions (table not created in Dashboard yet). */
function formatLeaderboardFetchError(message: string): string {
  if (
    message.includes("PGRST205") ||
    message.includes("Could not find the table") ||
    (message.includes("leaderboard_entries") && message.includes("schema cache"))
  ) {
    return (
      "Leaderboard table is missing in your Supabase project. In the Supabase Dashboard open " +
      "SQL Editor, paste and run `supabase/migrations/20260418120000_leaderboard_entries.sql`, " +
      "then reopen this panel."
    );
  }
  return message;
}

async function fetchFollowedSpotifyUserIdsTauri(): Promise<string[]> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return [];
  }
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<string[]>("get_spotify_followed_user_ids");
  } catch {
    return [];
  }
}

export function LeaderboardPanel({
  open,
  onClose,
  trackId,
  difficulty,
  session,
  eligibleForRanking = true,
}: Props): React.ReactElement | null {
  const settings = useGameStore((s) => s.settings);
  const spotifyUser = useGameStore((s) => s.spotifyUser);
  const [rows, setRows] = useState<LeaderboardData>({ global: [], friends: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !settings.supabaseUrl || !settings.supabaseAnonKey) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const clientCfg: SupabaseClientConfig = {
          url: settings.supabaseUrl!,
          anonKey: settings.supabaseAnonKey!,
          playerName:
            spotifyUser?.displayName ?? settings.playerName ?? "Anonymous",
        };
        if (spotifyUser?.id) {
          clientCfg.spotifyUserId = spotifyUser.id;
        }
        const client = new SupabaseLeaderboardClient(clientCfg);

        if (
          session &&
          eligibleForRanking &&
          !submittedSessionIdsRef.current.has(session.id)
        ) {
          await client.submitScore(session);
          submittedSessionIdsRef.current.add(session.id);
        }

        const global = (
          await client.getLeaderboard(trackId, difficulty, LEADERBOARD_LIMIT)
        ).entries;

        const friendSpotifyIds = await fetchFollowedSpotifyUserIdsTauri();
        const friends =
          friendSpotifyIds.length > 0
            ? await client.getFriendLeaderboardForSpotifyUsers(
                trackId,
                difficulty,
                friendSpotifyIds,
                LEADERBOARD_LIMIT
              )
            : await client.getFriendLeaderboard(
                trackId,
                difficulty,
                [],
                LEADERBOARD_LIMIT
              );

        if (!cancelled) {
          setRows({ global, friends: friends.entries });
        }
      } catch (err) {
        if (!cancelled) {
          const raw = err instanceof Error ? err.message : String(err);
          setError(formatLeaderboardFetchError(raw));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    difficulty,
    eligibleForRanking,
    open,
    session?.id,
    settings.playerName,
    settings.supabaseAnonKey,
    settings.supabaseUrl,
    spotifyUser?.displayName,
    spotifyUser?.id,
    trackId,
  ]);

  if (!open) return null;

  const profileLine = spotifyUser
    ? `Playing as ${spotifyUser.displayName}${
        spotifyUser.email ? ` · ${spotifyUser.email}` : ""
      }`
    : settings.playerName
      ? `Playing as ${settings.playerName}`
      : null;

  return (
    <div
      className="leaderboard-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="leaderboard-modal thin-scrollbar">
        <div className="leaderboard-header">
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            <img
              src={GAME_LOGO_SRC}
              alt={`${GAME_TITLE} logo`}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                objectFit: "cover",
                border: "1px solid rgba(255,255,255,0.18)",
                flexShrink: 0,
              }}
            />
            <h3>Leaderboard</h3>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {!settings.supabaseUrl || !settings.supabaseAnonKey ? (
          <p className="leaderboard-empty">
            Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable online leaderboards.
          </p>
        ) : (
          <>
            {profileLine ? (
              <p className="leaderboard-session">{profileLine}</p>
            ) : (
              <p className="leaderboard-empty">
                Connect Spotify in the app — your display name is used automatically.
              </p>
            )}
            <p className="leaderboard-empty" style={{ opacity: 0.75 }}>
              Friends list uses Spotify accounts you follow (scope: user-follow-read). Add{" "}
              <code style={{ fontSize: "9px" }}>spotify_user_id</code> to your Supabase table
              (see docs) for friend ranks.
            </p>
          </>
        )}
        {eligibleForRanking === false && (
          <p className="leaderboard-empty">
            This run used autoplay, so it is excluded from ranked leaderboards.
          </p>
        )}
        {error && <p className="leaderboard-error">{error}</p>}
        {busy && <p className="leaderboard-empty">Loading leaderboard…</p>}
        {!busy && (
          <div className="leaderboard-grid">
            <section>
              <h4>Global</h4>
              <LeaderboardRows rows={rows.global} />
            </section>
            <section>
              <h4>Friends</h4>
              <LeaderboardRows rows={rows.friends} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function LeaderboardRows({ rows }: { rows: LeaderboardEntry[] }): React.ReactElement {
  if (rows.length === 0) {
    return <p className="leaderboard-empty">No scores yet.</p>;
  }
  return (
    <div className="leaderboard-rows">
      {rows.map((row) => (
        <div key={`${row.sessionId}-${row.rank}`} className="leaderboard-row">
          <span>#{row.rank}</span>
          <span>{row.playerName}</span>
          <span>{row.score.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
