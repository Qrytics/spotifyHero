import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSchema, hasDatabase, sql } from "@/lib/db";
import { DIFFICULTIES } from "@/lib/types";

export const dynamic = "force-dynamic";

const NoteSchema = z.object({
  timeMs: z.number().finite().min(0).max(10 * 60 * 1000),
  lane: z.number().int().min(0).max(3),
  durationMs: z.number().finite().min(0).max(30_000),
  pitchHz: z.number().finite().positive().optional(),
});
const ChartSchema = z.object({
  trackId: z.string().max(64),
  difficulty: z.enum(DIFFICULTIES),
  notes: z.array(NoteSchema).max(6000),
  bpm: z.number().finite().positive().max(400),
  generatorVersion: z.string().max(80),
  generatedAt: z.coerce.date(),
});
const key = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  difficulty: z.enum(DIFFICULTIES),
  version: z.string().min(1).max(80),
});

type Row = { id: string; chart_json: unknown; title: string; author: string };

/** GET ?videoId&difficulty&version → the stored chart for that key, or 404 (client charts it). */
export async function GET(req: Request) {
  if (!hasDatabase()) return NextResponse.json({ error: "No database." }, { status: 503 });
  const q = key.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return NextResponse.json({ error: "Bad chart key." }, { status: 400 });
  await ensureSchema();
  const { videoId, difficulty, version } = q.data;
  const r = await sql`SELECT id, chart_json, title, author FROM sh_charts
    WHERE youtube_video_id = ${videoId} AND difficulty = ${difficulty} AND generator_version = ${version} LIMIT 1`;
  const row = r.rows[0] as Row | undefined;
  if (!row) return NextResponse.json({ error: "Not charted yet." }, { status: 404 });
  return NextResponse.json({ chartId: row.id, chart: row.chart_json, title: row.title });
}

const postSchema = key.extend({
  title: z.string().max(200),
  author: z.string().max(200).default(""),
  durationMs: z.number().int().positive().max(10 * 60 * 1000),
  chart: ChartSchema,
});

/**
 * POST a chart the client just generated. First writer wins: on a conflict the stored chart is
 * returned instead, so two players who chart the same song at once still end up ranked on one.
 */
export async function POST(req: Request) {
  if (!hasDatabase()) return NextResponse.json({ error: "No database." }, { status: 503 });
  const p = postSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Invalid chart." }, { status: 400 });
  const { videoId, difficulty, version, title, author, durationMs, chart } = p.data;
  if (chart.difficulty !== difficulty) return NextResponse.json({ error: "Difficulty mismatch." }, { status: 400 });
  if (chart.notes.some((n) => n.timeMs > durationMs + 2000))
    return NextResponse.json({ error: "Chart runs past the song." }, { status: 400 });
  await ensureSchema();
  await sql`INSERT INTO sh_charts (youtube_video_id, difficulty, generator_version, title, author, duration_ms, chart_json)
    VALUES (${videoId}, ${difficulty}, ${version}, ${title}, ${author}, ${durationMs}, ${JSON.stringify(chart)}::jsonb)
    ON CONFLICT (youtube_video_id, difficulty, generator_version) DO NOTHING`;
  const r = await sql`SELECT id, chart_json, title, author FROM sh_charts
    WHERE youtube_video_id = ${videoId} AND difficulty = ${difficulty} AND generator_version = ${version} LIMIT 1`;
  const row = r.rows[0] as Row;
  return NextResponse.json({ chartId: row.id, chart: row.chart_json, title: row.title });
}
