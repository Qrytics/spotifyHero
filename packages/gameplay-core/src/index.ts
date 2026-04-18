import type {
  Chart,
  GameSession,
  HitWindows,
  Judgement,
  Note,
  ScoreEvent,
} from "@spotifyhero/shared-types";
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

// ---------------------------------------------------------------------------
// ScoringEngine
// ---------------------------------------------------------------------------

/**
 * Stateful per-session scoring engine.
 *
 * Usage:
 *   const engine = new ScoringEngine(chart);
 *   engine.onNoteHit(noteIndex, actualTimeMs); // user/autoplay pressed
 *   engine.onNoteMissed(noteIndex);            // window expired
 *   engine.finalize();                         // → GameSession
 */
export class ScoringEngine {
  private readonly chart: Chart;
  private readonly windows: HitWindows;
  private readonly sessionId: string;

  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private hitCount = 0;
  private events: ScoreEvent[] = [];
  private judgedNotes = new Set<number>();
  private judgementCounts: Record<Judgement, number> = {
    perfect: 0,
    great: 0,
    good: 0,
    bad: 0,
    miss: 0,
  };

  constructor(chart: Chart, windows: HitWindows = DEFAULT_HIT_WINDOWS) {
    this.chart = chart;
    this.windows = windows;
    this.sessionId = globalThis.crypto.randomUUID();
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

  /** Call when a note is hit (manually or by autoplay). */
  onNoteHit(noteIndex: number, actualTimeMs: number): ScoreEvent | null {
    const note: Note | undefined = this.chart.notes[noteIndex];
    if (!note || this.judgedNotes.has(noteIndex)) return null;
    this.judgedNotes.add(noteIndex);

    const deltaMs = actualTimeMs - note.timeMs;
    const judgement = judgeHit(deltaMs, this.windows);

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
    this.judgementCounts[judgement] += 1;

    const event: ScoreEvent = {
      noteIndex,
      judgement,
      deltaMs,
      pointsAwarded,
      combo: this.combo,
    };
    this.events.push(event);
    return event;
  }

  /** Call when a note's window expires without being hit. */
  onNoteMissed(noteIndex: number): ScoreEvent | null {
    const note: Note | undefined = this.chart.notes[noteIndex];
    if (!note || this.judgedNotes.has(noteIndex)) return null;
    this.judgedNotes.add(noteIndex);

    this.combo = 0;
    this.judgementCounts["miss"] += 1;

    const event: ScoreEvent = {
      noteIndex,
      judgement: "miss",
      deltaMs: 0,
      pointsAwarded: 0,
      combo: 0,
    };
    this.events.push(event);
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

  constructor(
    chart: Chart,
    lookAheadMs = 2000,
    hitWindows: HitWindows = DEFAULT_HIT_WINDOWS
  ) {
    this.chart = chart;
    this.lookAheadMs = lookAheadMs;
    this.hitWindows = hitWindows;
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
      const delta = positionMs - note.timeMs;
      if (Math.abs(delta) <= this.hitWindows.perfect) {
        results.push({ index: i, note });
      }
    }
    return results;
  }

  /** Returns notes within the look-ahead window for rendering. */
  getVisibleNotes(positionMs: number): Array<{ index: number; note: Note }> {
    const results: Array<{ index: number; note: Note }> = [];
    for (let i = 0; i < this.chart.notes.length; i++) {
      const note = this.chart.notes[i];
      if (!note) continue;
      const timeUntil = note.timeMs - positionMs;
      if (timeUntil >= -this.hitWindows.bad && timeUntil <= this.lookAheadMs) {
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
      if (positionMs - note.timeMs > this.hitWindows.bad) {
        results.push({ index: i, note });
      }
    }
    return results;
  }

  reset(): void {
    this.nextNoteIndex = 0;
  }
}
