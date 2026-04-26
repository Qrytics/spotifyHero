import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSchema, sql } from "@/lib/db";
import { parseYouTubeId, sanitizeTitle } from "@/lib/youtube";
import { generateChartFromVideoId } from "@/lib/charting";
import type { Difficulty } from "@/lib/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  youtubeUrl: z.string().url(),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]).default("medium"),
});

export async function POST(req: Request) {
  await ensureSchema();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const videoId = parseYouTubeId(parsed.data.youtubeUrl);
  if (!videoId) {
    return NextResponse.json({ error: "Invalid YouTube URL." }, { status: 400 });
  }

  const existing =
    await sql`SELECT id, chart_json, title FROM sh_song_charts WHERE youtube_video_id = ${videoId} LIMIT 1`;
  const existingRow = existing.rows[0] as
    | { id: string; chart_json: unknown; title: string }
    | undefined;
  if (existingRow) {
    return NextResponse.json({
      status: "ready",
      chartId: existingRow.id,
      chart: existingRow.chart_json,
      title: existingRow.title,
      cacheHit: true,
    });
  }

  const insert =
    await sql`INSERT INTO sh_chart_jobs (youtube_video_id, source_url, status) VALUES (${videoId}, ${parsed.data.youtubeUrl}, 'queued') RETURNING id`;
  const jobId = String(insert.rows[0]?.id ?? "");

  const result = await processJob(jobId, videoId, parsed.data.youtubeUrl, parsed.data.difficulty);
  if (!result.ok) {
    return NextResponse.json({ status: "failed", jobId, error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    status: "ready",
    jobId,
    chartId: result.chartId,
    chart: result.chart,
    title: result.title,
    cacheHit: false,
  });
}

async function processJob(jobId: string, videoId: string, sourceUrl: string, difficulty: Difficulty) {
  try {
    await sql`UPDATE sh_chart_jobs SET status = 'processing', updated_at = NOW() WHERE id = ${jobId}`;
    const { chart, spectrogram } = await generateChartFromVideoId({
      videoId,
      sourceUrl,
      difficulty,
    });
    const title = sanitizeTitle(videoId);
    const stored =
      await sql`INSERT INTO sh_song_charts (youtube_video_id, source_url, title, chart_json, spectrogram_json, generator_version)
      VALUES (${videoId}, ${sourceUrl}, ${title}, ${JSON.stringify(chart)}::jsonb, ${JSON.stringify(spectrogram)}::jsonb, ${chart.generatorVersion})
      ON CONFLICT (youtube_video_id) DO UPDATE SET chart_json = EXCLUDED.chart_json, spectrogram_json = EXCLUDED.spectrogram_json
      RETURNING id, chart_json, title`;
    const row = stored.rows[0] as
      | { id: string; chart_json: unknown; title: string }
      | undefined;
    if (!row) {
      throw new Error("Chart record missing after upsert.");
    }
    await sql`UPDATE sh_chart_jobs SET status = 'ready', error_message = NULL, updated_at = NOW() WHERE id = ${jobId}`;
    await sql`DELETE FROM sh_chart_jobs WHERE youtube_video_id = ${videoId} AND id <> ${jobId}`;
    return { ok: true as const, chartId: row.id, chart: row.chart_json, title: row.title };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process chart job.";
    await sql`UPDATE sh_chart_jobs SET status = 'failed', error_message = ${message}, updated_at = NOW() WHERE id = ${jobId}`;
    return { ok: false as const, error: message };
  }
}
