import { NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await ensureSchema();
  const url = new URL(req.url);
  const chartId = url.searchParams.get("chartId");
  if (!chartId) {
    return NextResponse.json({ error: "chartId is required." }, { status: 400 });
  }

  const topScores = await sql`
    SELECT p.display_name, s.score, s.accuracy, s.max_combo, s.created_at
    FROM sh_scores s
    JOIN sh_players p ON p.id = s.player_id
    WHERE s.chart_id = ${chartId}
    ORDER BY s.score DESC
    LIMIT 20
  `;

  const mostPlayed = await sql`
    SELECT c.id, c.title, COUNT(*)::int AS plays
    FROM sh_scores s
    JOIN sh_song_charts c ON c.id = s.chart_id
    GROUP BY c.id, c.title
    ORDER BY plays DESC
    LIMIT 10
  `;

  return NextResponse.json({
    topPlayers: topScores.rows,
    mostPlayedSongs: mostPlayed.rows,
  });
}
