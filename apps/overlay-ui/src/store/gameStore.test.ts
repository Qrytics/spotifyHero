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
