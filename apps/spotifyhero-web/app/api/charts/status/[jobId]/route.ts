import { NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/db";
import type { Chart } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { jobId: string } }) {
  await ensureSchema();
  const { rows } =
    await sql`SELECT id, youtube_video_id, status, error_message FROM sh_chart_jobs WHERE id = ${params.jobId} LIMIT 1`;
  const row = rows[0] as
    | { id: string; youtube_video_id: string; status: string; error_message: string | null }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  if (row.status !== "ready") {
    return NextResponse.json({
      status: row.status,
      error: row.status === "failed" ? row.error_message : null,
    });
  }

  const chartRows =
    await sql`SELECT id, title, chart_json FROM sh_song_charts WHERE youtube_video_id = ${row.youtube_video_id} LIMIT 1`;
  const chart = chartRows.rows[0] as { id: string; title: string; chart_json: Chart } | undefined;
  if (!chart) {
    return NextResponse.json({ status: "processing" });
  }
  return NextResponse.json({
    status: "ready",
    chartId: chart.id,
    title: chart.title,
    chart: chart.chart_json,
  });
}
