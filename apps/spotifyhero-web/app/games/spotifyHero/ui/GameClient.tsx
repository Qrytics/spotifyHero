"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  CHART_LEAD_IN_MS,
  DEFAULT_HIT_WINDOWS,
  ScoringEngine,
  chartEndPlaybackMs,
  noteHeadTimeMs,
} from "@spotifyhero/gameplay-core";
import { useGameStore } from "@spotifyhero/game-state";
import type { OnsetAnalysisResult } from "@spotifyhero/onset-analysis";
import type { Chart, Difficulty, GameSession, HitWindows } from "@spotifyhero/shared-types";
import { PIPELINE_VERSION, analyzeBuffer, chartFromAnalysis } from "@/lib/client/analyze";
import { SongPlayer, audioContext, scheduleCountInClicks, unlockAudio } from "@/lib/client/songPlayer";
import { DIFFICULTIES } from "@/lib/types";

/**
 * The web edition: paste a YouTube link → the server converts it to mp3 → this page decodes it,
 * charts it with the desktop app's "My Library" pipeline (onset analysis + chart generator),
 * and plays it on the real note highway, scored by the real `ScoringEngine`.
 *
 * The game loop and key handling mirror apps/overlay-ui/src/hooks/useGameLoop.ts: a lane press
 * judges the nearest unresolved note in that lane inside the `bad` window, and every frame
 * advances holds and sweeps misses. The highway reads the same store the desktop app does.
 */
const Highway = dynamic(() => import("./Highway"), { ssr: false });

const API = "/games/spotifyHero/api";
const LANE_KEYS = ["d", "f", "j", "k"] as const;
const COUNT_IN_BEATS = 3;
const COUNT_IN_BEAT_MS = 1000;
/** The desktop app's expert windows (useGameLoop.ts): expert charts are dense enough to need them. */
const EXPERT_HIT_WINDOWS: HitWindows = { perfect: 88, great: 108, good: 138, bad: 188 };

type Player = { id: string; email: string; displayName: string } | null;
type SongMeta = { videoId: string; title: string; author: string; durationMs: number };
type Stage = "downloading" | "decoding" | "analyzing" | "charting";
type View =
  | { kind: "idle" }
  | { kind: "loading"; stage: Stage; progress: number | null }
  | { kind: "playing" }
  | { kind: "paused" }
  | { kind: "results"; session: GameSession; submitted: "yes" | "guest" | "no" | "pending" }
  | { kind: "error"; message: string };
type Row = { display_name: string; score: number; accuracy: string | number; max_combo: number };
type Played = { video_id: string; title: string; plays: number };

const STAGE_LABEL: Record<Stage, string> = {
  downloading: "Converting to mp3",
  decoding: "Decoding audio",
  analyzing: "Finding the beats",
  charting: "Writing the chart",
};

const windowsFor = (c: Chart): HitWindows => (c.difficulty === "expert" ? EXPERT_HIT_WINDOWS : DEFAULT_HIT_WINDOWS);

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writeNumber(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* private mode */
  }
}

export function GameClient() {
  const [url, setUrl] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [song, setSong] = useState<SongMeta | null>(null);
  const [chartId, setChartId] = useState<string | null>(null);
  const [countIn, setCountIn] = useState<number | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [offsetMs, setOffsetMs] = useState(0);
  const [speed, setSpeed] = useState(1.3);

  const [player, setPlayer] = useState<Player>(null);
  const [accounts, setAccounts] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [top, setTop] = useState<Row[]>([]);
  const [played, setPlayed] = useState<Played[]>([]);

  const score = useGameStore((s) => s.score);
  const combo = useGameStore((s) => s.combo);

  const songPlayer = useRef<SongPlayer | null>(null);
  const engineRef = useRef<ScoringEngine | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const songRef = useRef<SongMeta | null>(null);
  const analysisRef = useRef<{ videoId: string; result: OnsetAnalysisResult } | null>(null);
  const heldRef = useRef<boolean[]>([false, false, false, false]);
  const rafRef = useRef(0);
  const loadSeq = useRef(0);
  // Read from callbacks the audio fires (onended) and from rAF, where render-time state is stale.
  const offsetRef = useRef(0);
  const viewRef = useRef<View>(view);
  const playerRef = useRef<Player>(null);
  const chartIdRef = useRef<string | null>(null);
  viewRef.current = view;
  offsetRef.current = offsetMs;
  playerRef.current = player;
  chartIdRef.current = chartId;

  /** The clock everything judges and draws against: the exact playhead plus the player's offset. */
  const clock = useCallback(() => (songPlayer.current?.positionMs() ?? 0) + offsetRef.current, []);

  const go = (v: View) => {
    viewRef.current = v;
    setView(v);
  };

  useEffect(() => {
    setVolume(readNumber("sh-web-volume", 0.8));
    setOffsetMs(readNumber("sh-web-offset", 0));
    const s = readNumber("sh-web-speed", 1.3);
    setSpeed(s);
    useGameStore.getState().updateSettings({ autoplay: false, noteScrollSpeed: s });
    void refreshSession();
    void refreshBoards(null);
    return () => {
      cancelAnimationFrame(rafRef.current);
      songPlayer.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Loading a song ─────────────────────────────────────────────────────────
  async function load(link: string, diff: Difficulty) {
    const seq = ++loadSeq.current;
    const stale = () => seq !== loadSeq.current;
    // Unlock inside the click: after the first `await` the gesture no longer counts.
    void unlockAudio();
    stopRound();
    setChartId(null);
    const store = useGameStore.getState();
    store.resetRound();
    store.setPhase("loading");

    try {
      // Same song, new difficulty: the audio is already decoded — skip straight to charting.
      const reuse = songRef.current && songPlayer.current && link.includes(songRef.current.videoId);
      let meta: SongMeta;
      let buffer: AudioBuffer;
      if (reuse) {
        meta = songRef.current!;
        buffer = songPlayer.current!.buffer;
      } else {
        go({ kind: "loading", stage: "downloading", progress: null });
        const res = await fetch(`${API}/youtube/audio`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ youtubeUrl: link }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error ?? `The converter failed (${res.status}).`);
        }
        meta = JSON.parse(decodeURIComponent(res.headers.get("x-sh-meta") ?? "")) as SongMeta;
        const bytes = await readWithProgress(res, (p) => {
          if (!stale()) go({ kind: "loading", stage: "downloading", progress: p });
        });
        if (stale()) return;
        go({ kind: "loading", stage: "decoding", progress: null });
        buffer = await audioContext().decodeAudioData(bytes);
        if (stale()) return;
        songRef.current = meta;
        setSong(meta);
        songPlayer.current = new SongPlayer(buffer, volume);
      }

      const chart = await chartFor(meta, buffer, diff, stale);
      if (!chart || stale()) return;
      begin(chart);
    } catch (e) {
      if (stale()) return;
      useGameStore.getState().setPhase("idle");
      go({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  /**
   * The stored chart for this song + difficulty when there is one — so everyone on a leaderboard
   * plays the same notes — otherwise chart it here and offer it to the server.
   */
  async function chartFor(meta: SongMeta, buffer: AudioBuffer, diff: Difficulty, stale: () => boolean): Promise<Chart | null> {
    const key = { videoId: meta.videoId, difficulty: diff, version: PIPELINE_VERSION };
    const stored = await fetch(`${API}/charts?${new URLSearchParams(key)}`).catch(() => null);
    if (stored?.ok) {
      const data = (await stored.json()) as { chartId: string; chart: Chart };
      setChartId(data.chartId);
      chartIdRef.current = data.chartId;
      void refreshBoards(data.chartId);
      return data.chart;
    }

    let analysis = analysisRef.current?.videoId === meta.videoId ? analysisRef.current.result : null;
    if (!analysis) {
      go({ kind: "loading", stage: "analyzing", progress: 0 });
      analysis = await analyzeBuffer(buffer, (p) => {
        if (!stale()) go({ kind: "loading", stage: "analyzing", progress: p });
      });
      analysisRef.current = { videoId: meta.videoId, result: analysis };
    }
    if (stale()) return null;
    go({ kind: "loading", stage: "charting", progress: null });
    const local = await chartFromAnalysis(`yt:${meta.videoId}`, analysis, diff);

    const saved = await fetch(`${API}/charts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...key, title: meta.title, author: meta.author, durationMs: meta.durationMs, chart: local }),
    }).catch(() => null);
    if (saved?.ok) {
      const data = (await saved.json()) as { chartId: string; chart: Chart };
      setChartId(data.chartId);
      chartIdRef.current = data.chartId;
      void refreshBoards(data.chartId);
      return data.chart;
    }
    return local; // no database: still playable, just unranked
  }

  // ── A round ───────────────────────────────────────────────────────────────
  function begin(chart: Chart) {
    const p = songPlayer.current;
    const meta = songRef.current;
    if (!p || !meta) return;
    p.stop();
    chartRef.current = chart;
    engineRef.current = new ScoringEngine(chart, { windows: windowsFor(chart), chartLeadInMs: CHART_LEAD_IN_MS });
    heldRef.current = [false, false, false, false];
    const store = useGameStore.getState();
    store.resetRound();
    store.setPlayback(playbackState(meta, chart, true));
    store.setChart(chart);
    go({ kind: "playing" });
    p.onEnded = () => finish();
    void p
      .playFromTop(COUNT_IN_BEATS * COUNT_IN_BEAT_MS)
      .then((startsAt) => scheduleCountInClicks(startsAt, COUNT_IN_BEATS, COUNT_IN_BEAT_MS));
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
    // Dev-only hook for the timing test in scripts (a bot that presses on each note's time).
    if (process.env.NODE_ENV === "development") (window as unknown as { __sh?: unknown }).__sh = { chart, clock, engine: engineRef.current };
  }

  function loop() {
    const engine = engineRef.current;
    const chart = chartRef.current;
    if (!engine || !chart || viewRef.current.kind !== "playing") return;
    const pos = clock();
    const digit = pos < 0 ? Math.ceil(-pos / COUNT_IN_BEAT_MS) : null;
    setCountIn((c) => (c === digit ? c : digit));
    if (pos >= 0) {
      const events = [...engine.advanceHolds(pos, heldRef.current), ...engine.evaluateMisses(pos)];
      if (events.length) useGameStore.getState().onScoreEvents(events, chart.notes.length);
    }
    if (pos > chartEndPlaybackMs(chart, CHART_LEAD_IN_MS) + 1500) return finish();
    rafRef.current = requestAnimationFrame(loop);
  }

  function finish() {
    const engine = engineRef.current;
    const chart = chartRef.current;
    if (!engine || !chart || viewRef.current.kind === "results") return;
    cancelAnimationFrame(rafRef.current);
    const late = [...engine.advanceHolds(clock(), heldRef.current), ...engine.evaluateMisses(Number.MAX_SAFE_INTEGER)];
    if (late.length) useGameStore.getState().onScoreEvents(late, chart.notes.length);
    songPlayer.current?.pause();
    const who = playerRef.current;
    const cid = chartIdRef.current;
    const session = engine.finalize(who?.displayName ?? "Guest");
    useGameStore.getState().setSession(session);
    setCountIn(null);
    go({ kind: "results", session, submitted: who && cid ? "pending" : who ? "no" : "guest" });
    if (who && cid) void submit(session, cid);
  }

  function stopRound() {
    cancelAnimationFrame(rafRef.current);
    songPlayer.current?.stop();
    engineRef.current = null;
    chartRef.current = null;
    setCountIn(null);
  }

  function togglePause() {
    const p = songPlayer.current;
    const chart = chartRef.current;
    const meta = songRef.current;
    if (!p || !chart || !meta) return;
    if (viewRef.current.kind === "playing") {
      p.pause();
      cancelAnimationFrame(rafRef.current);
      useGameStore.getState().setPlayback(playbackState(meta, chart, false));
      go({ kind: "paused" });
    } else if (viewRef.current.kind === "paused") {
      void p.resume();
      useGameStore.getState().setPlayback(playbackState(meta, chart, true));
      go({ kind: "playing" });
      rafRef.current = requestAnimationFrame(loop);
    }
  }

  function retry() {
    if (chartRef.current) begin(chartRef.current);
  }

  /** Nearest unresolved note in the lane inside the `bad` window — useGameLoop's bestLaneHitIndex. */
  function judge(lane: number) {
    const engine = engineRef.current;
    const chart = chartRef.current;
    if (!engine || !chart) return;
    const pos = clock();
    const win = windowsFor(chart).bad;
    let best = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < chart.notes.length; i++) {
      const note = chart.notes[i]!;
      if (note.lane !== lane || engine.isResolved(i)) continue;
      const d = Math.abs(pos - noteHeadTimeMs(note, CHART_LEAD_IN_MS));
      if (d <= win && d < bestAbs) {
        bestAbs = d;
        best = i;
      }
    }
    if (best < 0) return;
    const ev = engine.onNoteHit(best, pos);
    if (ev) useGameStore.getState().onScoreEvent(ev, chart.notes.length);
  }

  // Keys: D F J K play, Space/Esc pause. Ignored while typing in a field.
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("input, textarea, select");
    const laneOf = (e: KeyboardEvent) => LANE_KEYS.indexOf(e.key.toLowerCase() as (typeof LANE_KEYS)[number]);
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.key === "Escape") {
        if (viewRef.current.kind === "playing" || viewRef.current.kind === "paused") {
          e.preventDefault();
          togglePause();
        }
        return;
      }
      const lane = laneOf(e);
      if (lane < 0 || viewRef.current.kind !== "playing") return;
      e.preventDefault();
      if (e.repeat) return;
      heldRef.current[lane] = true;
      window.dispatchEvent(new CustomEvent("spotifyhero:lanedown", { detail: { lane } }));
      judge(lane);
    };
    const up = (e: KeyboardEvent) => {
      const lane = laneOf(e);
      if (lane < 0) return;
      heldRef.current[lane] = false;
      window.dispatchEvent(new CustomEvent("spotifyhero:laneup", { detail: { lane } }));
    };
    const blur = () => {
      heldRef.current = [false, false, false, false];
      if (viewRef.current.kind === "playing") togglePause();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });

  // ── Accounts and boards ───────────────────────────────────────────────────
  async function refreshSession() {
    const res = await fetch(`${API}/auth/me`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { player: Player; accounts?: boolean } | null;
    setPlayer(data?.player ?? null);
    setAccounts(Boolean(res?.ok) && data?.accounts !== false);
  }

  async function auth(kind: "login" | "register" | "logout") {
    const res = await fetch(`${API}/auth/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(kind === "logout" ? {} : { body: JSON.stringify(kind === "register" ? { email, password, displayName } : { email, password }) }),
    }).catch(() => null);
    setAuthMsg(res?.ok ? "" : kind === "register" ? "Couldn't create that account." : "Wrong email or password.");
    if (res?.ok) setPassword("");
    await refreshSession();
  }

  async function refreshBoards(cid: string | null) {
    const res = await fetch(`${API}/leaderboard${cid ? `?chartId=${encodeURIComponent(cid)}` : ""}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { topPlayers?: Row[]; mostPlayedSongs?: Played[] } | null;
    setTop(data?.topPlayers ?? []);
    setPlayed(data?.mostPlayedSongs ?? []);
  }

  async function submit(session: GameSession, cid: string) {
    const res = await fetch(`${API}/scores`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chartId: cid, score: session.score, accuracy: session.accuracy, maxCombo: session.maxCombo }),
    }).catch(() => null);
    setView((v) => (v.kind === "results" ? { ...v, submitted: res?.ok ? "yes" : "no" } : v));
    void refreshBoards(cid);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const busy = view.kind === "loading";
  const inRound = view.kind === "playing" || view.kind === "paused" || view.kind === "results";
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !busy) void load(url.trim(), difficulty);
  };
  const playAt = (d: Difficulty) => {
    setDifficulty(d);
    if (songRef.current) void load(`https://youtu.be/${songRef.current.videoId}`, d);
  };

  return (
    <main className="sh">
      <header className="sh-head">
        <h1>
          spotify<span>Hero</span> <small>web</small>
        </h1>
        <p>Paste a YouTube song. It&rsquo;s converted, charted from the audio itself, and played on the highway.</p>
      </header>

      <form className="sh-load" onSubmit={onSubmit}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="YouTube link"
          disabled={busy}
        />
        <div className="sh-diffs" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={difficulty === d}
              className={difficulty === d ? "on" : ""}
              disabled={busy}
              onClick={() => setDifficulty(d)}
            >
              {d}
            </button>
          ))}
        </div>
        <button type="submit" className="sh-go" disabled={busy || !url.trim()}>
          {busy ? "Loading…" : "Play"}
        </button>
      </form>

      <section className="sh-stage">
        <div className="sh-highway">
          <Highway clock={clock} />
          {countIn !== null && (
            <div className="sh-countin" key={countIn}>
              {countIn}
            </div>
          )}
          {view.kind === "idle" && (
            <div className="sh-overlay">
              <p className="sh-big">Pick a song to start</p>
              <p>
                Keys <kbd>D</kbd> <kbd>F</kbd> <kbd>J</kbd> <kbd>K</kbd> · <kbd>Space</kbd> pauses
              </p>
            </div>
          )}
          {view.kind === "loading" && (
            <div className="sh-overlay">
              <p className="sh-big">{STAGE_LABEL[view.stage]}…</p>
              <div className="sh-progress" aria-hidden="true">
                <i className={view.progress === null ? "indet" : ""} style={{ width: `${Math.round((view.progress ?? 0) * 100)}%` }} />
              </div>
              <ol className="sh-steps">
                {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
                  <li key={s} className={s === view.stage ? "now" : ""}>
                    {STAGE_LABEL[s]}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {view.kind === "paused" && (
            <div className="sh-overlay">
              <p className="sh-big">Paused</p>
              <div className="sh-row">
                <button className="sh-go" onClick={togglePause}>
                  Resume
                </button>
                <button onClick={retry}>Restart</button>
              </div>
            </div>
          )}
          {view.kind === "results" && (
            <div className="sh-overlay">
              <p className="sh-grade">{grade(view.session.accuracy)}</p>
              <dl className="sh-results">
                <div>
                  <dt>Score</dt>
                  <dd>{view.session.score.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Accuracy</dt>
                  <dd>{(view.session.accuracy * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Max combo</dt>
                  <dd>{view.session.maxCombo}</dd>
                </div>
              </dl>
              <p className="sh-judges">
                {(["perfect", "great", "good", "bad", "miss"] as const).map((j) => (
                  <span key={j} className={`j-${j}`}>
                    {j} {view.session.judgements[j] ?? 0}
                  </span>
                ))}
              </p>
              <p className="sh-note">
                {view.submitted === "yes" && "Score saved to the leaderboard."}
                {view.submitted === "pending" && "Saving your score…"}
                {view.submitted === "guest" && (accounts ? "Playing as a guest. Sign in to rank." : "Leaderboards are offline here.")}
                {view.submitted === "no" && "This run wasn't ranked."}
              </p>
              <div className="sh-row">
                <button className="sh-go" onClick={retry}>
                  Play again
                </button>
                {DIFFICULTIES.filter((d) => d !== chartRef.current?.difficulty).map((d) => (
                  <button key={d} onClick={() => playAt(d)}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
          {view.kind === "error" && (
            <div className="sh-overlay">
              <p className="sh-big">That didn&rsquo;t work</p>
              <p className="sh-err">{view.message}</p>
            </div>
          )}
        </div>

        <aside className="sh-side">
          <div className="sh-card">
            <p className="sh-label">Now playing</p>
            <p className="sh-title">{song?.title ?? "—"}</p>
            <p className="sh-sub">{song?.author || "Paste a link above"}</p>
            {song && (
              <a className="sh-src" href={`https://www.youtube.com/watch?v=${song.videoId}`} target="_blank" rel="noopener noreferrer">
                on YouTube ↗
              </a>
            )}
          </div>

          <div className="sh-card sh-stats">
            <div>
              <span>Score</span>
              <b>{(inRound ? score : 0).toLocaleString()}</b>
            </div>
            <div>
              <span>Combo</span>
              <b>{inRound ? combo : 0}</b>
            </div>
            <div>
              <span>Difficulty</span>
              <b>{chartRef.current?.difficulty ?? difficulty}</b>
            </div>
          </div>

          <div className="sh-card sh-settings">
            <label>
              <span>
                Volume <em>{Math.round(volume * 100)}%</em>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  songPlayer.current?.setVolume(v);
                  writeNumber("sh-web-volume", v);
                }}
              />
            </label>
            <label>
              <span>
                Note speed <em>{speed.toFixed(2)}×</em>
              </span>
              <input
                type="range"
                min={0.6}
                max={3}
                step={0.05}
                value={speed}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSpeed(v);
                  useGameStore.getState().updateSettings({ noteScrollSpeed: v });
                  writeNumber("sh-web-speed", v);
                }}
              />
            </label>
            <label title="Raise it if every hit lands late, e.g. on Bluetooth headphones">
              <span>
                Audio offset{" "}
                <em>
                  {offsetMs > 0 ? "+" : ""}
                  {offsetMs} ms
                </em>
              </span>
              <input
                type="range"
                min={-200}
                max={200}
                step={5}
                value={offsetMs}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setOffsetMs(v);
                  writeNumber("sh-web-offset", v);
                }}
              />
            </label>
          </div>

          {accounts && (
            <div className="sh-card">
              {player ? (
                <div className="sh-row sh-between">
                  <span>
                    Signed in as <b>{player.displayName}</b>
                  </span>
                  <button onClick={() => void auth("logout")}>Sign out</button>
                </div>
              ) : (
                <form
                  className="sh-auth"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void auth(authMode);
                  }}
                >
                  <p className="sh-label">{authMode === "login" ? "Sign in to rank" : "Create an account"}</p>
                  {authMode === "register" && (
                    <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" required />
                  )}
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required autoComplete="email" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    minLength={8}
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  />
                  <div className="sh-row sh-between">
                    <button type="submit" className="sh-go">
                      {authMode === "login" ? "Sign in" : "Create"}
                    </button>
                    <button type="button" className="sh-link" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
                      {authMode === "login" ? "New? Create an account" : "Have an account? Sign in"}
                    </button>
                  </div>
                  {authMsg && <p className="sh-err">{authMsg}</p>}
                </form>
              )}
            </div>
          )}

          {chartId && (
            <div className="sh-card">
              <p className="sh-label">Top players · {chartRef.current?.difficulty}</p>
              {top.length ? (
                <ol className="sh-board">
                  {top.map((r, i) => (
                    <li key={i} className={player && r.display_name === player.displayName ? "me" : ""}>
                      <span>{r.display_name}</span>
                      <b>{Number(r.score).toLocaleString()}</b>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="sh-sub">No ranked runs yet. Be the first.</p>
              )}
            </div>
          )}

          {played.length > 0 && (
            <div className="sh-card">
              <p className="sh-label">Most played</p>
              <ol className="sh-board">
                {played.map((s) => (
                  <li key={s.video_id}>
                    <button
                      className="sh-link"
                      disabled={busy}
                      onClick={() => {
                        const u = `https://youtu.be/${s.video_id}`;
                        setUrl(u);
                        void load(u, difficulty);
                      }}
                    >
                      {s.title}
                    </button>
                    <b>{s.plays}</b>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function playbackState(meta: SongMeta, chart: Chart, isPlaying: boolean) {
  return {
    isPlaying,
    positionMs: 0,
    trackId: chart.trackId,
    track: {
      id: chart.trackId,
      name: meta.title,
      artists: meta.author ? [meta.author] : [],
      durationMs: Math.max(1, Math.round(meta.durationMs)),
    },
    source: "server" as const,
  };
}

function grade(acc: number): string {
  return acc >= 0.97 ? "S" : acc >= 0.9 ? "A" : acc >= 0.8 ? "B" : acc >= 0.7 ? "C" : "D";
}

async function readWithProgress(res: Response, onProgress: (p: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > total) break;
    out.set(value, got);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  return out.buffer.slice(0, got);
}
