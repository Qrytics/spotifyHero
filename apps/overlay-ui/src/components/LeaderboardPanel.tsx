import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Difficulty, GameSession, LeaderboardEntry } from "@spotifyhero/shared-types";
import { OfflineLeaderboardClient, SupabaseLeaderboardClient } from "@spotifyhero/leaderboard-client";
import { useGameStore } from "../store/gameStore.js";

type Props = {
  open: boolean;
  onClose: () => void;
  trackId: string;
  difficulty: Difficulty;
  session: GameSession;
  eligibleForRanking: boolean;
};

type LeaderboardData = {
  global: LeaderboardEntry[];
  friends: LeaderboardEntry[];
};

export function LeaderboardPanel({
  open,
  onClose,
  trackId,
  difficulty,
  session,
  eligibleForRanking,
}: Props): React.ReactElement | null {
  const settings = useGameStore((s) => s.settings);
  const [email, setEmail] = useState("");
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [rows, setRows] = useState<LeaderboardData>({ global: [], friends: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedSessionIdsRef = useRef<Set<string>>(new Set());

  const supabase: SupabaseClient | null = useMemo(() => {
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) return null;
    return createClient(settings.supabaseUrl, settings.supabaseAnonKey);
  }, [settings.supabaseAnonKey, settings.supabaseUrl]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setAuthSession(data.session ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setAuthSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!open || !supabase) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const sessionToken = authSession?.access_token;
        const userId = authSession?.user.id;
        const client = sessionToken
          ? new SupabaseLeaderboardClient({
              url: settings.supabaseUrl!,
              anonKey: settings.supabaseAnonKey!,
              ...(settings.playerName ? { playerName: settings.playerName } : {}),
              accessToken: sessionToken,
              ...(userId ? { userId } : {}),
            })
          : new OfflineLeaderboardClient();

        if (
          eligibleForRanking &&
          !submittedSessionIdsRef.current.has(session.id)
        ) {
          await client.submitScore(session);
          submittedSessionIdsRef.current.add(session.id);
        }

        const global = (await client.getLeaderboard(trackId, difficulty, 25)).entries;
        let friendIds: string[] = [];
        if (sessionToken && userId) {
          const { data, error: followsError } = await supabase
            .from("follows")
            .select("followee_id")
            .eq("follower_id", userId);
          if (followsError) {
            throw followsError;
          }
          friendIds = (data ?? [])
            .map((row) => String((row as { followee_id?: string }).followee_id ?? ""))
            .filter(Boolean);
        }
        const friends = (
          await client.getFriendLeaderboard(trackId, difficulty, friendIds, 25)
        ).entries;
        if (!cancelled) {
          setRows({ global, friends });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authSession?.access_token,
    authSession?.user.id,
    difficulty,
    open,
    session,
    settings.playerName,
    settings.supabaseAnonKey,
    settings.supabaseUrl,
    supabase,
    trackId,
  ]);

  if (!open) return null;

  const sendMagicLink = async (): Promise<void> => {
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="leaderboard-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="leaderboard-modal thin-scrollbar">
        <div className="leaderboard-header">
          <h3>Leaderboard</h3>
          <button type="button" onClick={onClose}>×</button>
        </div>
        {!settings.supabaseUrl || !settings.supabaseAnonKey ? (
          <p className="leaderboard-empty">
            Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable online leaderboards.
          </p>
        ) : authSession ? (
          <p className="leaderboard-session">
            Signed in as {authSession.user.email ?? authSession.user.id}
          </p>
        ) : (
          <div className="leaderboard-auth">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
            <button type="button" onClick={() => void sendMagicLink()} disabled={busy}>
              Send magic link
            </button>
          </div>
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
