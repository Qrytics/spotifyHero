import type {
  Chart,
  GameSession,
  HitWindows,
  Judgement,
  Note,
  ScoreEvent,
} from "@spotifyhero/shared-types";
import {
  noteHeadTimeMs,
  noteTailTimeMs,
} from "./chartTiming.js";
// Use Web Crypto randomUUID (available in Node ≥19 and all modern browsers)

// ---------------------------------------------------------------------------
// Hit-window defaults (milliseconds, ±)
// ---------------------------------------------------------------------------

export const DEFAULT_HIT_WINDOWS: HitWindows = {
  perfect: 22,
  great: 45,
  good: 90,
  bad: 135,
};

// Points awarded per judgement
const JUDGEMENT_POINTS: Record<Judgement, number> = {
  perfect: 1000,
  great: 750,
  good: 400,
  bad: 100,
  miss: 0,
};

// Combo multiplier breakpoints: [minCombo, multiplier]
const COMBO_MULTIPLIERS: Array<[number, number]> = [
  [100, 8],
  [50, 4],
  [10, 2],
  [0, 1],
];

function getComboMultiplier(combo: number): number {
  for (const [minCombo, multiplier] of COMBO_MULTIPLIERS) {
    if (combo >= minCombo) return multiplier;
  }
  return 1;
}

function judgeHit(deltaMs: number, windows: HitWindows): Judgement {
  const abs = Math.abs(deltaMs);
  if (abs <= windows.perfect) return "perfect";
  if (abs <= windows.great) return "great";
  if (abs <= windows.good) return "good";
  if (abs <= windows.bad) return "bad";
  return "miss";
}

/** Minimum ms between sustain checkpoints (gems along the hold). */
const HOLD_CHECKPOINT_SPACING_MS = 200;
/** Max checkpoints including tail time (tail is always last). */
const HOLD_MAX_CHECKPOINTS = 8;
/** Base points per sustain tick (combo multiplier applied). */
export const HOLD_TICK_BASE_POINTS = 220;

/**
 * Sustain gem times from note head through tail `timeMs + durationMs`.
 * Includes evenly spaced interior ticks plus the tail instant (must still be held).
 */
export function holdCheckpointTimes(note: Note): number[] {
  if (note.durationMs <= 0) return [];
  const { timeMs, durationMs } = note;
  const end = timeMs + durationMs;
  const raw = Math.floor(durationMs / HOLD_CHECKPOINT_SPACING_MS);
  const inner = Math.min(HOLD_MAX_CHECKPOINTS - 1, Math.max(0, raw));
  const times: number[] = [];
  if (inner > 0) {
    const seg = inner + 1;
    for (let k = 1; k <= inner; k++) {
      times.push(timeMs + (durationMs * k) / seg);
    }
  }
  times.push(end);
  return times;
}

interface ActiveHoldState {
  lane: number;
  checkpointTimes: number[];
  nextIdx: number;
}

// ---------------------------------------------------------------------------
// ScoringEngine
// ---------------------------------------------------------------------------

/**
 * Stateful per-session scoring engine.
 *
 * Usage:
 *   const engine = new ScoringEngine(chart);
 *   const engine = new ScoringEngine(chart, { chartLeadInMs: 4000 });
 *   engine.onNoteHit(noteIndex, actualTimeMs); // user/autoplay pressed
 *   engine.onNoteMissed(noteIndex);            // window expired
 *   engine.finalize();                         // → GameSession
 */
export type ScoringEngineOptions = {
  windows?: HitWindows;
  /** Shift note heads (and hold geometry) forward in playback time — runway before first hit. */
  chartLeadInMs?: number;
};

export class ScoringEngine {
  private readonly chart: Chart;
  private readonly windows: HitWindows;
  private readonly chartLeadInMs: number;
  private readonly sessionId: string;

  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private hitCount = 0;
  private events: ScoreEvent[] = [];
  /** Tap judged, hold finished, hold failed, or hold head missed. */
  private resolvedNotes = new Set<number>();
  private readonly activeHolds = new Map<number, ActiveHoldState>();
  private judgementCounts: Record<Judgement, number> = {
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    miss: 0,
  };

  constructor(chart: Chart, opts?: ScoringEngineOptions) {
    this.chart = chart;
    this.windows = opts?.windows ?? DEFAULT_HIT_WINDOWS;
    this.chartLeadInMs = opts?.chartLeadInMs ?? 0;
    this.sessionId = globalThis.crypto.randomUUID();
  }

  private headTime(note: Note): number {
    return noteHeadTimeMs(note, this.chartLeadInMs);
  }

  get currentScore(): number {
    return this.score;
  }

  get currentCombo(): number {
    return this.combo;
  }

  get sessionIdValue(): string {
    return this.sessionId;
  }

  /** Whether this note row is finished (tap) or sustain is done / failed. */
  isResolved(noteIndex: number): boolean {
    return this.resolvedNotes.has(noteIndex);
  }

  /**
   * After a large clock jump (seek), allow notes to be judged again from the new time.
   * Does not revert score — same limitation as clearing a judged set mid-session.
   */
  resetSeekState(): void {
    this.resolvedNotes.clear();
    this.activeHolds.clear();
  }

  private pushEvent(ev: ScoreEvent): void {
    this.events.push(ev);
  }

  private applyJudgementForAccuracy(judgement: Judgement, counts: boolean): void {
    if (!counts) return;
    this.judgementCounts[judgement] += 1;
  }

  private failActiveHold(noteIndex: number): ScoreEvent | null {
    if (!this.activeHolds.has(noteIndex)) return null;
    this.activeHolds.delete(noteIndex);
    this.resolvedNotes.add(noteIndex);
    this.combo = 0;
    this.judgementCounts["miss"] += 1;

    const event: ScoreEvent = {
      noteIndex,
      judgement: "miss",
      deltaMs: 0,
      pointsAwarded: 0,
      combo: 0,
      countsTowardAccuracy: true,
    };
    this.pushEvent(event);
    return event;
  }

  /** Call when a note is hit (manually or by autoplay). */
  onNoteHit(noteIndex: number, actualTimeMs: number): ScoreEvent | null {
    const note: Note | undefined = this.chart.notes[noteIndex];
    if (!note || this.resolvedNotes.has(noteIndex)) return null;
    if (this.activeHolds.has(noteIndex)) return null;

    const deltaMs = actualTimeMs - this.headTime(note);
    const judgement = judgeHit(deltaMs, this.windows);

    if (note.durationMs <= 0) {
      this.resolvedNotes.add(noteIndex);

      if (judgement === "miss" || judgement === "bad") {
        this.combo = 0;
      } else {
        this.combo += 1;
        this.hitCount += 1;
      }
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;

      const multiplier = getComboMultiplier(this.combo);
      const pointsAwarded = JUDGEMENT_POINTS[judgement] * multiplier;
      this.score += pointsAwarded;
      this.applyJudgementForAccuracy(judgement, true);

      const event: ScoreEvent = {
        noteIndex,
        judgement,
        deltaMs,
        pointsAwarded,
        combo: this.combo,
        countsTowardAccuracy: true,
      };
      this.pushEvent(event);
      return event;
    }

    // Hold: head timing
    if (judgement === "miss" || judgement === "bad") {
      this.resolvedNotes.add(noteIndex);
      this.combo = 0;
      this.applyJudgementForAccuracy(judgement, true);
      const multiplier = getComboMultiplier(this.combo);
      const pointsAwarded = JUDGEMENT_POINTS[judgement] * multiplier;
      this.score += pointsAwarded;

      const event: ScoreEvent = {
        noteIndex,
        judgement,
        deltaMs,
        pointsAwarded,
        combo: this.combo,
        countsTowardAccuracy: true,
      };
      this.pushEvent(event);
      return event;
    }

    this.combo += 1;
    this.hitCount += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    const multiplier = getComboMultiplier(this.combo);
    const pointsHead = JUDGEMENT_POINTS[judgement] * multiplier;
    this.score += pointsHead;
    this.applyJudgementForAccuracy(judgement, true);

    const checkpoints = holdCheckpointTimes(note).map(
      (t) => t + this.chartLeadInMs
    );
    this.activeHolds.set(noteIndex, {
      lane: note.lane,
      checkpointTimes: checkpoints,
      nextIdx: 0,
    });

    const event: ScoreEvent = {
      noteIndex,
      judgement,
      deltaMs,
      pointsAwarded: pointsHead,
      combo: this.combo,
      countsTowardAccuracy: true,
      showHitFx: false,
    };
    this.pushEvent(event);
    return event;
  }

  /**
   * Advance active sustains: awards tick points, detects early release (manual).
   * `laneHeld[lane]` = key down. Pass `null` in autoplay (always treats sustain as held).
   */
  advanceHolds(actualTimeMs: number, laneHeld: boolean[] | null): ScoreEvent[] {
    const out: ScoreEvent[] = [];
    const autoplay = laneHeld === null;

    outer: for (const [noteIndex, hold] of [...this.activeHolds.entries()]) {
      const note = this.chart.notes[noteIndex];
      if (!note) {
        this.activeHolds.delete(noteIndex);
        continue;
      }

      const endMs = noteTailTimeMs(note, this.chartLeadInMs);
      const tailTime = hold.checkpointTimes[hold.checkpointTimes.length - 1] ?? endMs;

      if (!autoplay) {
        const pressed = laneHeld![hold.lane] ?? false;
        if (
          !pressed &&
          actualTimeMs >= this.headTime(note) &&
          actualTimeMs < tailTime
        ) {
          const ev = this.failActiveHold(noteIndex);
          if (ev) out.push(ev);
          continue;
        }
      }

      while (hold.nextIdx < hold.checkpointTimes.length) {
        const cp = hold.checkpointTimes[hold.nextIdx]!;
        if (actualTimeMs < cp) break;

        const atTail = hold.nextIdx === hold.checkpointTimes.length - 1;
        const cpHeld = autoplay ? true : laneHeld![hold.lane] ?? false;
        if (!cpHeld) {
          const ev = this.failActiveHold(noteIndex);
          if (ev) out.push(ev);
          continue outer;
        }

        const mult = getComboMultiplier(this.combo);
        const tickPoints = HOLD_TICK_BASE_POINTS * mult;
        this.score += tickPoints;
        const tickEv: ScoreEvent = {
          noteIndex,
          judgement: "perfect",
          deltaMs: actualTimeMs - cp,
          pointsAwarded: tickPoints,
          combo: this.combo,
          countsTowardAccuracy: false,
          showHitFx: atTail,
        };
        this.pushEvent(tickEv);
        out.push(tickEv);

        hold.nextIdx += 1;

        if (atTail) {
          this.activeHolds.delete(noteIndex);
          this.resolvedNotes.add(noteIndex);
          break;
        }
      }
    }

    return out;
  }

  /** Missed tap heads and hold heads that were never struck. */
  evaluateMisses(positionMs: number): ScoreEvent[] {
    const out: ScoreEvent[] = [];
    for (let i = 0; i < this.chart.notes.length; i++) {
      if (this.resolvedNotes.has(i)) continue;
      const note = this.chart.notes[i];
      if (!note) continue;
      if (note.durationMs > 0 && this.activeHolds.has(i)) continue;

      if (positionMs - this.headTime(note) > this.windows.bad) {
        const ev = this.onNoteMissed(i);
        if (ev) out.push(ev);
      }
    }
    return out;
  }

  /** Call when a note's window expires without being hit. */
  onNoteMissed(noteIndex: number): ScoreEvent | null {
    const note: Note | undefined = this.chart.notes[noteIndex];
    if (!note || this.resolvedNotes.has(noteIndex)) return null;
    this.resolvedNotes.add(noteIndex);

    this.combo = 0;
    this.judgementCounts["miss"] += 1;

    const event: ScoreEvent = {
      noteIndex,
      judgement: "miss",
      deltaMs: 0,
      pointsAwarded: 0,
      combo: 0,
      countsTowardAccuracy: true,
    };
    this.pushEvent(event);
    return event;
  }

  /** Compute accuracy and return the final GameSession. */
  finalize(playerName?: string): GameSession {
    const totalNotes = this.chart.notes.length;
    const accuracy =
      totalNotes === 0
        ? 1
        : (this.judgementCounts.perfect + this.judgementCounts.great * 0.75) /
          totalNotes;

    return {
      id: this.sessionId,
      trackId: this.chart.trackId,
      difficulty: this.chart.difficulty,
      score: this.score,
      maxCombo: this.maxCombo,
      accuracy: Math.min(1, accuracy),
      judgements: { ...this.judgementCounts },
      playedAt: new Date(),
      playerName,
    };
  }

  getEvents(): ScoreEvent[] {
    return [...this.events];
  }
}

// ---------------------------------------------------------------------------
// Autoplay/Manual toggle controller
// ---------------------------------------------------------------------------

export type PlayMode = "autoplay" | "manual";

/**
 * Manages whether the game is in autoplay or manual mode and fires
 * hit callbacks for autoplay timing.
 */
export class PlayModeController {
  private mode: PlayMode;
  private onModeChange?: (mode: PlayMode) => void;

  constructor(initialMode: PlayMode = "autoplay") {
    this.mode = initialMode;
  }

  getMode(): PlayMode {
    return this.mode;
  }

  setOnModeChange(cb: (mode: PlayMode) => void): void {
    this.onModeChange = cb;
  }

  toggle(): PlayMode {
    this.mode = this.mode === "autoplay" ? "manual" : "autoplay";
    this.onModeChange?.(this.mode);
    return this.mode;
  }

  setMode(mode: PlayMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.onModeChange?.(this.mode);
    }
  }

  isAutoplay(): boolean {
    return this.mode === "autoplay";
  }
}

// ---------------------------------------------------------------------------
// NoteWindow manager – tracks which notes are in the active window
// ---------------------------------------------------------------------------

/**
 * Given the current playback position, returns notes that should be
 * auto-hit (in autoplay mode) or are within reach for manual input.
 */
export class NoteWindowManager {
  private readonly chart: Chart;
  private nextNoteIndex = 0;
  /** How many ms ahead to surface notes to the renderer. */
  private readonly lookAheadMs: number;
  /** Miss window – notes this far past without hit are marked missed. */
  private readonly hitWindows: HitWindows;
  private readonly chartLeadInMs: number;

  constructor(
    chart: Chart,
    lookAheadMs = 2000,
    hitWindows: HitWindows = DEFAULT_HIT_WINDOWS,
    chartLeadInMs = 0
  ) {
    this.chart = chart;
    this.lookAheadMs = lookAheadMs;
    this.hitWindows = hitWindows;
    this.chartLeadInMs = chartLeadInMs;
  }

  /**
   * Returns notes that are due for autoplay hit at the current position.
   * A note is "due" when the current time is within the perfect window of its timeMs.
   */
  getAutoplayHits(positionMs: number): Array<{ index: number; note: Note }> {
    const results: Array<{ index: number; note: Note }> = [];
    for (let i = 0; i < this.chart.notes.length; i++) {
      const note = this.chart.notes[i];
      if (!note) continue;
      const head = noteHeadTimeMs(note, this.chartLeadInMs);
      const delta = positionMs - head;
      if (Math.abs(delta) <= this.hitWindows.perfect) {
        results.push({ index: i, note });
      }
    }
    return results;
  }

  /** Returns notes within the look-ahead window for rendering (includes sustain tails). */
  getVisibleNotes(positionMs: number): Array<{ index: number; note: Note }> {
    const results: Array<{ index: number; note: Note }> = [];
    for (let i = 0; i < this.chart.notes.length; i++) {
      const note = this.chart.notes[i];
      if (!note) continue;
      const head = noteHeadTimeMs(note, this.chartLeadInMs);
      const endMs = noteTailTimeMs(note, this.chartLeadInMs);
      const headOk = head - positionMs <= this.lookAheadMs;
      const tailOk = endMs >= positionMs - this.hitWindows.bad;
      if (headOk && tailOk) {
        results.push({ index: i, note });
      }
    }
    return results;
  }

  /** Returns notes whose miss window has expired. */
  getMissedNotes(
    positionMs: number,
    alreadyJudged: Set<number>
  ): Array<{ index: number; note: Note }> {
    const results: Array<{ index: number; note: Note }> = [];
    for (let i = 0; i < this.chart.notes.length; i++) {
      if (alreadyJudged.has(i)) continue;
      const note = this.chart.notes[i];
      if (!note) continue;
      const head = noteHeadTimeMs(note, this.chartLeadInMs);
      if (positionMs - head > this.hitWindows.bad) {
        results.push({ index: i, note });
      }
    }
    return results;
  }

  reset(): void {
    this.nextNoteIndex = 0;
  }
}

export * from "./chartTiming.js";
