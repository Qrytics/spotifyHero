import { NextResponse } from "next/server";
import { ensureSchema, hasDatabase, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET [?chartId] → top players on that chart, and the most-played songs overall. */
export async function GET(req: Request) {
  if (!hasDatabase()) return NextResponse.json({ topPlayers: [], mostPlayedSongs: [] });
  await ensureSchema();
  const chartId = new URL(req.url).searchParams.get("chartId");

  const topScores = chartId
    ? await sql`
        SELECT p.display_name, s.score, s.accuracy, s.max_combo, s.created_at
        FROM sh_chart_scores s
        JOIN sh_players p ON p.id = s.player_id
        WHERE s.chart_id = ${chartId}
        ORDER BY s.score DESC
        LIMIT 10`
    : { rows: [] };

  const mostPlayed = await sql`
    SELECT c.youtube_video_id AS video_id, MIN(c.title) AS title, COUNT(*)::int AS plays
    FROM sh_chart_scores s
    JOIN sh_charts c ON c.id = s.chart_id
    GROUP BY c.youtube_video_id
    ORDER BY plays DESC
    LIMIT 8`;

  return NextResponse.json({ topPlayers: topScores.rows, mostPlayedSongs: mostPlayed.rows });
}
