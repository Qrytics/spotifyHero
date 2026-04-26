import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionPlayer } from "@/lib/auth";
import { ensureSchema, sql } from "@/lib/db";
import type { Chart } from "@/lib/types";
import { HOLD_TICK_BASE_POINTS, holdCheckpointTimes } from "@/lib/scoring";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  chartId: z.string().uuid(),
  score: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  maxCombo: z.number().int().nonnegative(),
});

export async function POST(req: Request) {
  await ensureSchema();
  const player = await getSessionPlayer();
  if (!player) {
    return NextResponse.json(
      { error: "Guest scores are not submitted to leaderboard." },
      { status: 401 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid score payload." }, { status: 400 });
  }

  const { chartId, score, accuracy, maxCombo } = parsed.data;
  const chartResult = await sql`SELECT chart_json FROM sh_song_charts WHERE id = ${chartId} LIMIT 1`;
  const chartRow = chartResult.rows[0] as { chart_json: Chart } | undefined;
  if (!chartRow) {
    return NextResponse.json({ error: "Chart not found." }, { status: 404 });
  }
  const maxScore = estimateMaxScore(chartRow.chart_json);
  if (score > maxScore || maxCombo > chartRow.chart_json.notes.length) {
    return NextResponse.json({ error: "Score rejected by anti-cheat validation." }, { status: 400 });
  }

  await sql`
    INSERT INTO sh_scores (player_id, chart_id, score, accuracy, max_combo)
    VALUES (${player.id}, ${chartId}, ${score}, ${accuracy}, ${maxCombo})
    ON CONFLICT (player_id, chart_id)
    DO UPDATE SET
      score = GREATEST(sh_scores.score, EXCLUDED.score),
      accuracy = CASE WHEN EXCLUDED.score >= sh_scores.score THEN EXCLUDED.accuracy ELSE sh_scores.accuracy END,
      max_combo = GREATEST(sh_scores.max_combo, EXCLUDED.max_combo),
      created_at = CASE WHEN EXCLUDED.score >= sh_scores.score THEN NOW() ELSE sh_scores.created_at END
  `;
  return NextResponse.json({ ok: true });
}

function estimateMaxScore(chart: Chart): number {
  let total = 0;
  for (const note of chart.notes) {
    total += 1000 * 8;
    if (note.durationMs > 0) {
      const ticks = holdCheckpointTimes(note).length;
      total += ticks * HOLD_TICK_BASE_POINTS * 8;
    }
  }
  return total;
}
