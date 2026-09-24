import { beforeEach, describe, expect, it } from "vitest";
import type { Chart, PlaybackState } from "@spotifyhero/shared-types";
import { useGameStore } from "./gameStore.js";

function makeChart(trackId: string): Chart {
  return {
    trackId,
    difficulty: "expert",
    bpm: 120,
    generatorVersion: "test",
    generatedAt: new Date(),
    notes: [{ timeMs: 1000, lane: 0, durationMs: 1200 }],
  };
}

function resetStore(): void {
  const settings = useGameStore.getState().settings;
  useGameStore.setState({
    phase: "idle",
    trackLifecycle: "idle",
    playback: null,
    chart: null,
    settings,
    lastPlayPhase: settings.autoplay ? "autoplay" : "manual",
    sessionPlayMode: null,
    score: 0,
    combo: 0,
    maxCombo: 0,
    accuracy: 1,
    lastScoreEvent: null,
    lastScoreEventBatch: null,
    scoreEventSeq: 0,
    session: null,
  });
}

function playback(
  patch: Partial<PlaybackState> & Pick<PlaybackState, "isPlaying" | "positionMs">
): PlaybackState {
  return {
    isPlaying: patch.isPlaying,
    positionMs: patch.positionMs,
    trackId: patch.trackId ?? null,
    track: patch.track ?? null,
    volumePercent: patch.volumePercent ?? null,
  };
}

describe("gameStore setPlayback chart reload gating", () => {
  beforeEach(() => {
    resetStore();
  });

  it("does not reload chart after transient idle recovery to same track", () => {
    const chart = makeChart("track-a");
    useGameStore.setState({
      chart,
      phase: "manual",
      playback: playback({ isPlaying: true, positionMs: 1000, trackId: "track-a" }),
      lastPlayPhase: "manual",
    });

    useGameStore
      .getState()
      .setPlayback(playback({ isPlaying: false, positionMs: 1800, trackId: null }));
    expect(useGameStore.getState().phase).toBe("paused");

    useGameStore
      .getState()
      .setPlayback(playback({ isPlaying: true, positionMs: 2100, trackId: "track-a" }));

    const state = useGameStore.getState();
    expect(state.phase).not.toBe("loading");
    expect(state.chart).toBe(chart);
    expect(state.phase === "manual" || state.phase === "autoplay").toBe(true);
  });

  it("reloads chart on true track change", () => {
    const chart = makeChart("track-a");
    useGameStore.setState({
      chart,
      phase: "manual",
      playback: playback({ isPlaying: true, positionMs: 1200, trackId: "track-a" }),
      lastPlayPhase: "manual",
    });

    useGameStore
      .getState()
      .setPlayback(playback({ isPlaying: true, positionMs: 200, trackId: "track-b" }));

    const state = useGameStore.getState();
    expect(state.phase).toBe("loading");
    expect(state.trackLifecycle).toBe("loading");
    expect(state.chart).toBeNull();
    expect(state.sessionPlayMode).toBe("manual");
  });
});

describe("gameStore updateSettings difficulty regen", () => {
  beforeEach(() => {
    resetStore();
  });

  it("enters loading and clears chart when difficulty changes mid-session", () => {
    const chart = makeChart("track-a");
    chart.difficulty = "medium";
    useGameStore.setState({
      chart,
      phase: "manual",
      playback: playback({ isPlaying: true, positionMs: 5000, trackId: "track-a" }),
      lastPlayPhase: "manual",
      score: 1200,
      combo: 5,
    });

    useGameStore.getState().updateSettings({ difficulty: "hard" });

    const state = useGameStore.getState();
    expect(state.phase).toBe("loading");
    expect(state.trackLifecycle).toBe("loading");
    expect(state.chart).toBeNull();
    expect(state.score).toBe(0);
    expect(state.sessionPlayMode).toBe("manual");
    expect(state.settings.difficulty).toBe("hard");
  });

  it("does not regen when difficulty is unchanged", () => {
    const chart = makeChart("track-a");
    useGameStore.setState({
      chart,
      phase: "manual",
      playback: playback({ isPlaying: true, positionMs: 1000, trackId: "track-a" }),
    });
    const d = useGameStore.getState().settings.difficulty;

    useGameStore.getState().updateSettings({ difficulty: d });

    expect(useGameStore.getState().chart).toBe(chart);
    expect(useGameStore.getState().phase).toBe("manual");
  });
});

describe("gameStore music source switch", () => {
  beforeEach(() => {
    resetStore();
  });

  /** Puts the store mid-song on `source`, with the round already under way. */
  function playing(source: "spotify" | "server"): void {
    useGameStore.getState().updateSettings({ musicSource: source });
    useGameStore.setState({
      chart: makeChart("track-a"),
      phase: "manual",
      playback: playback({ isPlaying: true, positionMs: 20_000, trackId: "track-a" }),
      lastPlayPhase: "manual",
      score: 4200,
      combo: 12,
    });
  }

  /**
   * `App.tsx` gates the gameplay view on `autoplay | manual | paused` and both the
   * source picker and the library screen on `idle`. A switch that leaves the phase
   * alone therefore strands the player on the old source's highway.
   */
  it("returns to idle when leaving Spotify for My Library", () => {
    playing("spotify");

    useGameStore.getState().updateSettings({ musicSource: "server" });

    const state = useGameStore.getState();
    expect(state.settings.musicSource).toBe("server");
    expect(state.phase).toBe("idle");
    expect(state.trackLifecycle).toBe("idle");
    expect(state.chart).toBeNull();
    expect(state.playback).toBeNull();
    expect(state.score).toBe(0);
  });

  it("returns to idle in the other direction too", () => {
    playing("server");

    useGameStore.getState().updateSettings({ musicSource: "spotify" });

    expect(useGameStore.getState().phase).toBe("idle");
    expect(useGameStore.getState().chart).toBeNull();
  });

  it("returns to idle when clearing the source back to the picker", () => {
    playing("server");

    useGameStore.getState().updateSettings({ musicSource: null });

    expect(useGameStore.getState().settings.musicSource).toBeNull();
    expect(useGameStore.getState().phase).toBe("idle");
  });

  /**
   * The settings panel saves every field at once, so `musicSource` is present in
   * the patch on *every* Save. Comparing values rather than testing for presence
   * is what keeps a scroll-speed tweak from ending the round.
   */
  it("does not touch the round when the source is unchanged", () => {
    playing("server");
    const chart = useGameStore.getState().chart;

    useGameStore
      .getState()
      .updateSettings({ musicSource: "server", noteScrollSpeed: 2.2 });

    const state = useGameStore.getState();
    expect(state.phase).toBe("manual");
    expect(state.chart).toBe(chart);
    expect(state.playback?.trackId).toBe("track-a");
    expect(state.score).toBe(4200);
    expect(state.settings.noteScrollSpeed).toBeCloseTo(2.2);
  });
});

describe("gameStore resetRound clears the loaded track", () => {
  beforeEach(() => {
    resetStore();
  });

  it("drops playback along with the chart", () => {
    useGameStore.setState({
      chart: makeChart("track-a"),
      phase: "paused",
      playback: playback({ isPlaying: false, positionMs: 4000, trackId: "track-a" }),
    });

    useGameStore.getState().resetRound();

    const state = useGameStore.getState();
    expect(state.playback).toBeNull();
    expect(state.chart).toBeNull();
    expect(state.phase).toBe("idle");
    expect(state.trackLifecycle).toBe("idle");
  });

  /**
   * The My Library regression: pause, ✕ back to the library, pick another song.
   * `onSelectSong` sets `phase: "loading"` before `prepare()` resolves, so if
   * `resetRound` left the old `playback` behind, the store would sit in
   * `loading` + the *previous* `trackId` — which is all
   * `useServerChartGeneration` needs to fire for the wrong track and serve its
   * cached chart, killing the loading screen on the frame it appeared.
   *
   * A null `trackId` is what makes that hook no-op until the real track lands.
   */
  it("leaves no stale trackId for the next song's loading phase", () => {
    useGameStore.setState({
      chart: makeChart("track-a"),
      phase: "manual",
      playback: playback({ isPlaying: true, positionMs: 30_000, trackId: "track-a" }),
    });

    useGameStore.getState().resetRound();
    // The library screen's pick, before the new track has downloaded.
    useGameStore.getState().setPhase("loading");

    const state = useGameStore.getState();
    expect(state.phase).toBe("loading");
    expect(state.trackLifecycle).toBe("loading");
    expect(state.playback?.trackId ?? null).toBeNull();
  });
});
