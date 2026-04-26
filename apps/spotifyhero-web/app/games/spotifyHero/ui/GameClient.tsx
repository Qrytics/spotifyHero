"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Chart } from "@/lib/types";
import { ScoringEngine } from "@/lib/scoring";

type Player = { id: string; email: string; displayName: string } | null;
type LeaderboardRow = {
  display_name: string;
  score: number;
  accuracy: string | number;
  max_combo: number;
  created_at: string;
};
type MostPlayedRow = { id: string; title: string; plays: number };

const LANE_KEYS = ["d", "f", "j", "k"] as const;
const HIT_WINDOW_MS = 90;

export function GameClient() {
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [difficulty, setDifficulty] = useState<Chart["difficulty"]>("medium");
  const [chart, setChart] = useState<Chart | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [songTitle, setSongTitle] = useState<string>("No song loaded");
  const [jobStatus, setJobStatus] = useState<string>("");
  const [player, setPlayer] = useState<Player>(null);
  const [mode, setMode] = useState<"guest" | "account">("guest");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [score, setScore] = useState(0);
  const [accuracy, setAccuracy] = useState(1);
  const [maxCombo, setMaxCombo] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gameTimeMs, setGameTimeMs] = useState(0);
  const [topPlayers, setTopPlayers] = useState<LeaderboardRow[]>([]);
  const [mostPlayedSongs, setMostPlayedSongs] = useState<MostPlayedRow[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const engineRef = useRef<ScoringEngine | null>(null);
  const startEpochRef = useRef<number | null>(null);
  const judgedRef = useRef<Set<number>>(new Set());

  const visibleNotes = useMemo(() => {
    if (!chart) return [];
    const lookAheadMs = 2200;
    const lookBehindMs = 250;
    return chart.notes
      .map((note, index) => ({ note, index }))
      .filter(
        ({ note }) =>
          note.timeMs >= gameTimeMs - lookBehindMs && note.timeMs <= gameTimeMs + lookAheadMs
      );
  }, [chart, gameTimeMs]);

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (!playing || !chart) return;
    const timer = window.setInterval(() => {
      if (!startEpochRef.current) return;
      const elapsed = Date.now() - startEpochRef.current;
      setGameTimeMs(elapsed);
      const endMs = chart.notes[chart.notes.length - 1]?.timeMs ?? 0;
      if (elapsed > endMs + 1500) {
        stopGameAndFinalize();
      }
    }, 16);
    return () => window.clearInterval(timer);
  }, [playing, chart]);

  useEffect(() => {
    if (!playing || !chart) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const lane = LANE_KEYS.indexOf(key as (typeof LANE_KEYS)[number]);
      if (lane === -1) return;
      const now = gameTimeMs;
      const target = chart.notes.find(
        (note, idx) =>
          note.lane === lane &&
          !judgedRef.current.has(idx) &&
          Math.abs(note.timeMs - now) <= HIT_WINDOW_MS
      );
      if (!target || !engineRef.current) return;
      const idx = chart.notes.indexOf(target);
      judgedRef.current.add(idx);
      engineRef.current.onNoteHit(idx, now);
      setScore(engineRef.current.currentScore);
      setMaxCombo(engineRef.current.currentCombo);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playing, chart, gameTimeMs]);

  async function refreshSession() {
    const res = await fetch("/api/auth/me");
    const data = (await res.json()) as { player: Player };
    setPlayer(data.player);
    setMode(data.player ? "account" : "guest");
  }

  async function register() {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });
    if (!res.ok) {
      setStatusMessage("Register failed.");
      return;
    }
    setStatusMessage("Account created.");
    await refreshSession();
  }

  async function login() {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      setStatusMessage("Login failed.");
      return;
    }
    setStatusMessage("Logged in.");
    await refreshSession();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setStatusMessage("Logged out.");
    await refreshSession();
  }

  async function queueChart() {
    setJobStatus("Queueing chart...");
    const res = await fetch("/api/charts/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ youtubeUrl, difficulty }),
    });
    const data = (await res.json()) as
      | { status: "ready"; chartId: string; chart: Chart; title: string }
      | { status: "queued"; jobId: string }
      | { error: string };
    if ("error" in data) {
      setJobStatus(data.error);
      return;
    }
    if (data.status === "ready") {
      setChart(data.chart);
      setChartId(data.chartId);
      setSongTitle(data.title);
      setJobStatus("Chart loaded from DB cache.");
      await refreshLeaderboards(data.chartId);
      return;
    }
    setJobStatus("Generating chart asynchronously...");
    const poll = window.setInterval(async () => {
      const statusRes = await fetch(`/api/charts/status/${data.jobId}`);
      const status = (await statusRes.json()) as
        | { status: "ready"; chartId: string; chart: Chart; title: string }
        | { status: string; error?: string };
      if (status.status === "failed") {
        window.clearInterval(poll);
        setJobStatus(status.error ?? "Chart job failed.");
        return;
      }
      if (status.status === "ready" && "chart" in status) {
        window.clearInterval(poll);
        setChart(status.chart);
        setChartId(status.chartId);
        setSongTitle(status.title);
        setJobStatus("Chart ready.");
        await refreshLeaderboards(status.chartId);
      }
    }, 1500);
  }

  function startGame() {
    if (!chart) return;
    // No autoplay in this edition.
    engineRef.current = new ScoringEngine(chart);
    judgedRef.current = new Set();
    setScore(0);
    setMaxCombo(0);
    setAccuracy(1);
    setGameTimeMs(0);
    startEpochRef.current = Date.now();
    setPlaying(true);
  }

  async function stopGameAndFinalize() {
    setPlaying(false);
    const engine = engineRef.current;
    if (!engine) return;
    const session = engine.finalize(player?.displayName ?? "Guest");
    setScore(session.score);
    setMaxCombo(session.maxCombo);
    setAccuracy(session.accuracy);
    if (player && chartId) {
      await fetch("/api/scores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chartId,
          score: session.score,
          accuracy: session.accuracy,
          maxCombo: session.maxCombo,
        }),
      });
      await refreshLeaderboards(chartId);
      setStatusMessage("Score submitted to leaderboard.");
    } else {
      setStatusMessage("Guest run complete. Leaderboard submission skipped.");
    }
  }

  async function refreshLeaderboards(cid: string) {
    const res = await fetch(`/api/leaderboard?chartId=${encodeURIComponent(cid)}`);
    const data = (await res.json()) as {
      topPlayers: LeaderboardRow[];
      mostPlayedSongs: MostPlayedRow[];
    };
    setTopPlayers(data.topPlayers ?? []);
    setMostPlayedSongs(data.mostPlayedSongs ?? []);
  }

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 20, display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>spotifyHero Web Edition</h1>
      <p style={{ margin: 0, opacity: 0.8 }}>
        Paste a YouTube URL, generate or reuse a chart from DB, then play manually (no auto mode).
      </p>

      <section style={{ display: "grid", gap: 8, background: "#13131b", padding: 12, borderRadius: 12 }}>
        <strong>Chart Source</strong>
        <input
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={{ padding: 10, borderRadius: 8, border: "1px solid #323242", background: "#0f0f16", color: "white" }}
        />
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as Chart["difficulty"])}
          style={{ width: 160, padding: 8, borderRadius: 8, border: "1px solid #323242", background: "#0f0f16", color: "white" }}
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
          <option value="expert">expert</option>
        </select>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={queueChart} style={btnStyle}>Generate / Load Chart</button>
          <button onClick={startGame} style={btnStyle} disabled={!chart || playing}>Start Run</button>
          <button onClick={stopGameAndFinalize} style={btnStyle} disabled={!playing}>Finish Run</button>
        </div>
        <small style={{ opacity: 0.8 }}>{songTitle}</small>
        <small style={{ opacity: 0.8 }}>{jobStatus}</small>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        <div style={{ height: 560, background: "#11131d", borderRadius: 12, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: "auto 0 70px", height: 2, background: "rgba(255,255,255,0.2)" }} />
          {visibleNotes.map(({ note, index }) => {
            const distance = note.timeMs - gameTimeMs;
            const y = 500 - distance * 0.22;
            const laneWidth = 25;
            const left = 24 + note.lane * 70;
            if (y < -50 || y > 560) return null;
            return (
              <div
                key={`${index}-${note.timeMs}`}
                style={{
                  position: "absolute",
                  left,
                  width: laneWidth,
                  borderRadius: 8,
                  top: y,
                  height: Math.max(14, note.durationMs * 0.16),
                  background: "#1db954",
                  boxShadow: "0 0 14px rgba(29,185,84,0.6)",
                }}
              />
            );
          })}
          <div style={{ position: "absolute", left: 16, bottom: 14, fontSize: 12, opacity: 0.9 }}>
            Keys: D F J K
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <section style={panelStyle}>
            <strong>Account / Guest</strong>
            <small style={{ opacity: 0.8 }}>
              Guests can play, but only logged-in players submit to leaderboard.
            </small>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={btnStyleSecondary} onClick={() => setMode("guest")}>Guest</button>
              <button style={btnStyleSecondary} onClick={() => setMode("account")}>Account</button>
            </div>
            {mode === "account" && !player && (
              <>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" style={inputStyle} />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inputStyle} />
                <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" style={inputStyle} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={btnStyle} onClick={register}>Register</button>
                  <button style={btnStyle} onClick={login}>Login</button>
                </div>
              </>
            )}
            {player && (
              <>
                <small>Signed in as {player.displayName}</small>
                <button style={btnStyleSecondary} onClick={logout}>Logout</button>
              </>
            )}
          </section>

          <section style={panelStyle}>
            <strong>Run Stats</strong>
            <small>Score: {score.toLocaleString()}</small>
            <small>Accuracy: {(accuracy * 100).toFixed(2)}%</small>
            <small>Max Combo: {maxCombo}</small>
            <small>{statusMessage}</small>
          </section>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={panelStyle}>
          <strong>Top Players</strong>
          {topPlayers.length === 0 ? <small>No scores yet.</small> : null}
          {topPlayers.map((row, i) => (
            <small key={`${row.display_name}-${i}`}>
              #{i + 1} {row.display_name} - {Number(row.score).toLocaleString()} ({(Number(row.accuracy) * 100).toFixed(1)}%)
            </small>
          ))}
        </div>
        <div style={panelStyle}>
          <strong>Most Played Songs</strong>
          {mostPlayedSongs.length === 0 ? <small>No songs played yet.</small> : null}
          {mostPlayedSongs.map((row) => (
            <small key={row.id}>{row.title} - {row.plays} plays</small>
          ))}
        </div>
      </section>
    </main>
  );
}

const panelStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  background: "#13131b",
  padding: 12,
  borderRadius: 12,
};

const btnStyle: CSSProperties = {
  border: "none",
  borderRadius: 8,
  background: "#1db954",
  color: "#081208",
  fontWeight: 700,
  padding: "10px 12px",
};

const btnStyleSecondary: CSSProperties = {
  border: "1px solid #323242",
  borderRadius: 8,
  background: "#0f0f16",
  color: "#ececf2",
  padding: "8px 12px",
};

const inputStyle: CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid #323242",
  background: "#0f0f16",
  color: "white",
};
