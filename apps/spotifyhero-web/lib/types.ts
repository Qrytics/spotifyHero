export type Difficulty = "easy" | "medium" | "hard" | "expert";

export type Note = {
  timeMs: number;
  lane: number;
  durationMs: number;
};

export type Chart = {
  trackId: string;
  difficulty: Difficulty;
  notes: Note[];
  bpm: number;
  generatorVersion: string;
  generatedAt: Date;
};
