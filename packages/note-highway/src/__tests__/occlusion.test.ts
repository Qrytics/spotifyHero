import { describe, it, expect } from "vitest";
import type { Note, ScoreEvent } from "@spotifyhero/shared-types";
import { CHART_LEAD_IN_MS } from "@spotifyhero/gameplay-core";
import {
  applyScoreEventToVisibility,
  buildSortedNotes,
  clearNoteVisibility,
  createNoteVisibility,
  lowerBoundSortedTime,
  occludedInsideSustain,
  scoreEventBurstJudgement,
} from "../noteVisibility.js";

/**
 * Sustain visibility has broken four separate times — see
 * `docs/sustain-visual-troubleshooting.md`. Every previous break was someone
 * tidying a conditional in here. These tests are the pin.
 */

function tap(timeMs: number, lane: number): Note {
  return { timeMs, lane, durationMs: 0 };
}
function hold(timeMs: number, lane: number, durationMs: number): Note {
  return { timeMs, lane, durationMs };
}

function ev(partial: Partial<ScoreEvent> & { noteIndex: number }): ScoreEvent {
  return {
    noteIndex: partial.noteIndex,
    judgement: partial.judgement ?? "perfect",
    deltaMs: partial.deltaMs ?? 0,
    pointsAwarded: partial.pointsAwarded ?? 100,
    combo: partial.combo ?? 1,
    ...(partial.countsTowardAccuracy === undefined
      ? {}
      : { countsTowardAccuracy: partial.countsTowardAccuracy }),
    ...(partial.showHitFx === undefined ? {} : { showHitFx: partial.showHitFx }),
  } as ScoreEvent;
}

describe("buildSortedNotes", () => {
  it("keeps chart indices when the chart is already in time order", () => {
    const notes = [tap(0, 0), tap(100, 1), tap(200, 2)];
    const sorted = buildSortedNotes(notes);
    expect(sorted.map((s) => s.chartIndex)).toEqual([0, 1, 2]);
  });

  it("sorts out-of-order charts while preserving the original indices", () => {
    const notes = [tap(500, 0), tap(100, 1), tap(300, 2)];
    const sorted = buildSortedNotes(notes);
    expect(sorted.map((s) => s.note.timeMs)).toEqual([100, 300, 500]);
    // Score events arrive by chart index, so the mapping must survive the sort.
    expect(sorted.map((s) => s.chartIndex)).toEqual([1, 2, 0]);
  });

  it("handles the empty and single-note charts without allocating a sort", () => {
    expect(buildSortedNotes([]).length).toBe(0);
    expect(buildSortedNotes([tap(7, 3)])[0]?.chartIndex).toBe(0);
  });
});

describe("lowerBoundSortedTime", () => {
  const sorted = buildSortedNotes([tap(0, 0), tap(100, 0), tap(100, 1), tap(400, 2)]);

  it("finds the first index at or after t", () => {
    expect(lowerBoundSortedTime(sorted, -1)).toBe(0);
    expect(lowerBoundSortedTime(sorted, 0)).toBe(0);
    expect(lowerBoundSortedTime(sorted, 1)).toBe(1);
    expect(lowerBoundSortedTime(sorted, 100)).toBe(1);
    expect(lowerBoundSortedTime(sorted, 101)).toBe(3);
    expect(lowerBoundSortedTime(sorted, 9999)).toBe(4);
  });
});

describe("occludedInsideSustain", () => {
  it("occludes a tap whose head is strictly inside a hold on the same lane", () => {
    const notes = [hold(1000, 0, 1000), tap(1500, 0)];
    const out = occludedInsideSustain(buildSortedNotes(notes), CHART_LEAD_IN_MS);
    expect(out.has(1)).toBe(true);
    expect(out.has(0)).toBe(false);
  });

  it("does not occlude across lanes", () => {
    const notes = [hold(1000, 0, 1000), tap(1500, 1)];
    const out = occludedInsideSustain(buildSortedNotes(notes), CHART_LEAD_IN_MS);
    expect(out.size).toBe(0);
  });

  it("occludes a tap landing exactly on a hold's tail — the next-onset case", () => {
    // Otherwise the tail cap and the gem paint on top of each other.
    const notes = [hold(1000, 0, 1000), tap(2000, 0)];
    const out = occludedInsideSustain(buildSortedNotes(notes), CHART_LEAD_IN_MS);
    expect(out.has(1)).toBe(true);
  });

  it("does not occlude a tap at a hold's head", () => {
    const notes = [hold(1000, 0, 1000), tap(1000, 0)];
    const out = occludedInsideSustain(buildSortedNotes(notes), CHART_LEAD_IN_MS);
    expect(out.has(1)).toBe(false);
  });

  it("occludes a hold whose head is inside another hold, but never at the tail", () => {
    const inside = occludedInsideSustain(
      buildSortedNotes([hold(1000, 0, 1000), hold(1500, 0, 300)]),
      CHART_LEAD_IN_MS
    );
    expect(inside.has(1)).toBe(true);

    // A hold starting exactly at the previous tail is a chained hold: keep it.
    const chained = occludedInsideSustain(
      buildSortedNotes([hold(1000, 0, 1000), hold(2000, 0, 500)]),
      CHART_LEAD_IN_MS
    );
    expect(chained.size).toBe(0);
  });

  it("never occludes a note against itself", () => {
    const out = occludedInsideSustain(
      buildSortedNotes([hold(1000, 0, 1000)]),
      CHART_LEAD_IN_MS
    );
    expect(out.size).toBe(0);
  });

  it("ignores zero-length 'holds'", () => {
    const out = occludedInsideSustain(
      buildSortedNotes([hold(1000, 0, 0), tap(1000, 0)]),
      CHART_LEAD_IN_MS
    );
    expect(out.size).toBe(0);
  });
});

describe("scoreEventBurstJudgement", () => {
  it("bursts on a normal tap hit", () => {
    expect(scoreEventBurstJudgement(ev({ noteIndex: 0 }), tap(0, 0))).toBe("perfect");
  });

  it("is silent for a hold's interior ticks", () => {
    const tick = ev({ noteIndex: 0, countsTowardAccuracy: false, judgement: "great" });
    expect(scoreEventBurstJudgement(tick, hold(0, 0, 1000))).toBe(null);
  });

  it("bursts on the hold tail tick, which is the one that sets showHitFx", () => {
    const tail = ev({
      noteIndex: 0,
      countsTowardAccuracy: false,
      judgement: "great",
      showHitFx: true,
    });
    expect(scoreEventBurstJudgement(tail, hold(0, 0, 1000))).toBe("great");
  });

  it("respects an explicit suppression on a normal event", () => {
    const quiet = ev({ noteIndex: 0, showHitFx: false });
    expect(scoreEventBurstJudgement(quiet, tap(0, 0))).toBe(null);
  });

  it("always bursts a miss", () => {
    expect(scoreEventBurstJudgement(ev({ noteIndex: 0, judgement: "miss" }), tap(0, 0))).toBe(
      "miss"
    );
  });
});

describe("applyScoreEventToVisibility", () => {
  it("hides a tap the instant it is hit", () => {
    const vis = createNoteVisibility();
    applyScoreEventToVisibility(ev({ noteIndex: 4 }), tap(1000, 0), vis);
    expect(vis.goneTap.has(4)).toBe(true);
    expect(vis.missSlide.has(4)).toBe(false);
  });

  it("slides a missed note instead of hiding it", () => {
    const vis = createNoteVisibility();
    applyScoreEventToVisibility(ev({ noteIndex: 4, judgement: "miss" }), tap(1000, 0), vis);
    expect(vis.missSlide.has(4)).toBe(true);
    expect(vis.goneTap.has(4)).toBe(false);
  });

  it("marks a hold head as held: strip stays, head gem goes", () => {
    const vis = createNoteVisibility();
    const note = hold(1000, 0, 800);
    applyScoreEventToVisibility(ev({ noteIndex: 2 }), note, vis);
    const s = vis.activeSustains.get(2);
    expect(s?.headHidden).toBe(true);
    expect(s?.completed).toBe(false);
    expect(s?.startTime).toBe(1000);
    expect(s?.endTime).toBe(1800);
    expect(vis.goneTap.has(2)).toBe(false);
  });

  it("keeps the hold alive through interior ticks without completing it", () => {
    const vis = createNoteVisibility();
    const note = hold(1000, 0, 800);
    applyScoreEventToVisibility(ev({ noteIndex: 2 }), note, vis);
    applyScoreEventToVisibility(
      ev({ noteIndex: 2, countsTowardAccuracy: false, judgement: "great" }),
      note,
      vis
    );
    const s = vis.activeSustains.get(2);
    expect(s?.completed).toBe(false);
    expect(s?.headHidden).toBe(true);
    expect(vis.goneTap.has(2)).toBe(false);
  });

  it("completes the hold on the tail tick", () => {
    const vis = createNoteVisibility();
    const note = hold(1000, 0, 800);
    applyScoreEventToVisibility(ev({ noteIndex: 2 }), note, vis);
    applyScoreEventToVisibility(
      ev({ noteIndex: 2, countsTowardAccuracy: false, judgement: "great", showHitFx: true }),
      note,
      vis
    );
    expect(vis.activeSustains.get(2)?.completed).toBe(true);
    expect(vis.goneTap.has(2)).toBe(true);
  });

  it("drops a hold out of the active set when it is later missed", () => {
    const vis = createNoteVisibility();
    const note = hold(1000, 0, 800);
    applyScoreEventToVisibility(ev({ noteIndex: 2 }), note, vis);
    applyScoreEventToVisibility(ev({ noteIndex: 2, judgement: "miss" }), note, vis);
    expect(vis.activeSustains.has(2)).toBe(false);
    expect(vis.missSlide.has(2)).toBe(true);
    expect(vis.goneTap.has(2)).toBe(false);
  });

  it("re-hitting after a miss clears the slide", () => {
    const vis = createNoteVisibility();
    const note = tap(1000, 0);
    applyScoreEventToVisibility(ev({ noteIndex: 2, judgement: "miss" }), note, vis);
    applyScoreEventToVisibility(ev({ noteIndex: 2, judgement: "good" }), note, vis);
    expect(vis.missSlide.has(2)).toBe(false);
    expect(vis.goneTap.has(2)).toBe(true);
  });

  it("ignores a judgement that is neither good nor failed", () => {
    const vis = createNoteVisibility();
    // @ts-expect-error — deliberately outside the Judgement union.
    applyScoreEventToVisibility(ev({ noteIndex: 1, judgement: "unknown" }), tap(0, 0), vis);
    expect(vis.goneTap.size).toBe(0);
    expect(vis.missSlide.size).toBe(0);
    expect(vis.activeSustains.size).toBe(0);
  });
});

describe("clearNoteVisibility", () => {
  it("empties all three sets, as a seek/replay requires", () => {
    const vis = createNoteVisibility();
    applyScoreEventToVisibility(ev({ noteIndex: 0 }), tap(0, 0), vis);
    applyScoreEventToVisibility(ev({ noteIndex: 1 }), hold(0, 1, 500), vis);
    applyScoreEventToVisibility(ev({ noteIndex: 2, judgement: "miss" }), tap(0, 2), vis);

    clearNoteVisibility(vis);

    expect(vis.goneTap.size).toBe(0);
    expect(vis.activeSustains.size).toBe(0);
    expect(vis.missSlide.size).toBe(0);
  });
});
