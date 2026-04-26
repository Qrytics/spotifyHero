import type { Chart, Note } from "./types";

export const HOLD_TICK_BASE_POINTS = 220;

export function holdCheckpointTimes(note: Note): number[] {
  if (note.durationMs <= 0) return [];
  const spacing = 200;
  const times: number[] = [];
  for (let t = note.timeMs + spacing; t < note.timeMs + note.durationMs; t += spacing) {
    times.push(t);
  }
  times.push(note.timeMs + note.durationMs);
  return times;
}

export class ScoringEngine {
  private readonly chart: Chart;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private judged = new Set<number>();

  constructor(chart: Chart) {
    this.chart = chart;
  }

  onNoteHit(noteIndex: number, actualTimeMs: number) {
    const note = this.chart.notes[noteIndex];
    if (!note || this.judged.has(noteIndex)) return;
    this.judged.add(noteIndex);
    const delta = Math.abs(actualTimeMs - note.timeMs);
    const judgementBase = delta <= 40 ? 1000 : delta <= 80 ? 750 : delta <= 110 ? 400 : 100;
    const mult = this.combo >= 100 ? 8 : this.combo >= 50 ? 4 : this.combo >= 10 ? 2 : 1;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += judgementBase * mult;
  }

  get currentScore() {
    return this.score;
  }

  get currentCombo() {
    return this.combo;
  }

  finalize(playerName: string) {
    return {
      score: this.score,
      maxCombo: this.maxCombo,
      accuracy: this.chart.notes.length === 0 ? 1 : this.judged.size / this.chart.notes.length,
      playerName,
    };
  }
}
