import { z } from "zod";

// ---------------------------------------------------------------------------
// Song / Track
// ---------------------------------------------------------------------------

export const SpotifyTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  /** Spotify image URLs are usually https; avoid strict URL() validation (browser vs Node edge cases). */
  albumArt: z.string().optional(),
  durationMs: z.coerce.number().int().positive(),
  bpm: z.number().positive().optional(),
});

export type SpotifyTrack = z.infer<typeof SpotifyTrackSchema>;

// ---------------------------------------------------------------------------
// Note chart
// ---------------------------------------------------------------------------

/** Lanes 0-3 = D F J K (or ← ↓ ↑ →).  5-lane uses 0-4. */
export const NoteSchema = z.object({
  /** Time offset from song start in milliseconds. */
  timeMs: z.number().nonnegative(),
  /** Lane index (0-based). */
  lane: z.number().int().min(0).max(4),
  /** Duration in ms; 0 for tap notes, >0 for holds. */
  durationMs: z.number().nonnegative().default(0),
});

export type Note = z.infer<typeof NoteSchema>;

export const DifficultySchema = z.enum(["easy", "medium", "hard", "expert"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const ChartSchema = z.object({
  trackId: z.string(),
  difficulty: DifficultySchema,
  notes: z.array(NoteSchema),
  /** Average BPM detected for this chart */
  bpm: z.number().positive(),
  /** Generator that produced this chart */
  generatorVersion: z.string(),
  generatedAt: z.coerce.date(),
});

export type Chart = z.infer<typeof ChartSchema>;

// ---------------------------------------------------------------------------
// Gameplay state
// ---------------------------------------------------------------------------

export const JudgementSchema = z.enum([
  "perfect",
  "great",
  "good",
  "bad",
  "miss",
]);
export type Judgement = z.infer<typeof JudgementSchema>;

export const HitWindowsSchema = z.object({
  perfect: z.number().int().positive().describe("±ms for Perfect"),
  great: z.number().int().positive().describe("±ms for Great"),
  good: z.number().int().positive().describe("±ms for Good"),
  bad: z.number().int().positive().describe("±ms for Bad"),
});
export type HitWindows = z.infer<typeof HitWindowsSchema>;

export const ScoreEventSchema = z.object({
  noteIndex: z.number().int().nonnegative(),
  judgement: JudgementSchema,
  deltaMs: z.number().describe("Actual hit time minus note time"),
  pointsAwarded: z.number().int().nonnegative(),
  combo: z.number().int().nonnegative(),
});
export type ScoreEvent = z.infer<typeof ScoreEventSchema>;

export const GameSessionSchema = z.object({
  id: z.string().uuid(),
  trackId: z.string(),
  difficulty: DifficultySchema,
  score: z.number().int().nonnegative(),
  maxCombo: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1).describe("0.0 – 1.0"),
  judgements: z.record(JudgementSchema, z.number().int().nonnegative()),
  playedAt: z.coerce.date(),
  playerName: z.string().optional(),
});
export type GameSession = z.infer<typeof GameSessionSchema>;

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  playerName: z.string(),
  score: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  maxCombo: z.number().int().nonnegative(),
  playedAt: z.coerce.date(),
  sessionId: z.string().uuid(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardSchema = z.object({
  trackId: z.string(),
  difficulty: DifficultySchema,
  entries: z.array(LeaderboardEntrySchema),
  fetchedAt: z.coerce.date(),
});
export type Leaderboard = z.infer<typeof LeaderboardSchema>;

// ---------------------------------------------------------------------------
// Challenge / share payload
// ---------------------------------------------------------------------------

export const ChallengePayloadSchema = z.object({
  challengerId: z.string(),
  challengerName: z.string(),
  trackId: z.string(),
  trackName: z.string(),
  difficulty: DifficultySchema,
  score: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  shareUrl: z.string().url(),
  expiresAt: z.coerce.date().optional(),
});
export type ChallengePayload = z.infer<typeof ChallengePayloadSchema>;

// ---------------------------------------------------------------------------
// Audio / beat-tracking events (IPC bridge)
// ---------------------------------------------------------------------------

export const BeatEventSchema = z.object({
  timeMs: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  isBeat: z.boolean(),
  isOnset: z.boolean(),
});
export type BeatEvent = z.infer<typeof BeatEventSchema>;

export const PlaybackStateSchema = z.object({
  isPlaying: z.boolean(),
  positionMs: z.coerce.number().nonnegative(),
  trackId: z.string().nullable(),
  track: SpotifyTrackSchema.nullable(),
});
export type PlaybackState = z.infer<typeof PlaybackStateSchema>;

// ---------------------------------------------------------------------------
// Window / app settings
// ---------------------------------------------------------------------------

export const WindowSettingsSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().int().min(200).default(360),
  height: z.number().int().min(400).default(640),
  alwaysOnTop: z.boolean().default(true),
  opacity: z.number().min(0.1).max(1).default(0.95),
});
export type WindowSettings = z.infer<typeof WindowSettingsSchema>;

export const AppSettingsSchema = z.object({
  window: WindowSettingsSchema.default({}),
  difficulty: DifficultySchema.default("medium"),
  autoplay: z.boolean().default(true),
  playKeybind: z.string().default("Space"),
  laneKeys: z.tuple([z.string(), z.string(), z.string(), z.string()]).default([
    "d",
    "f",
    "j",
    "k",
  ]),
  playerName: z.string().max(32).optional(),
  supabaseUrl: z.string().url().optional(),
  supabaseAnonKey: z.string().optional(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;
