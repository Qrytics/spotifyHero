import { NextResponse } from "next/server";
import { z } from "zod";
import { HOLD_TICK_BASE_POINTS, holdCheckpointTimes } from "@spotifyhero/gameplay-core";
import { getSessionPlayer } from "@/lib/auth";
import { ensureSchema, hasDatabase, sql } from "@/lib/db";
import type { Chart } from "@/lib/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  chartId: z.string().uuid(),
  score: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  maxCombo: z.number().int().nonnegative(),
});

export async function POST(req: Request) {
  if (!hasDatabase()) return NextResponse.json({ error: "No database." }, { status: 503 });
  await ensureSchema();
  const player = await getSessionPlayer();
  if (!player) {
    return NextResponse.json({ error: "Guest scores are not submitted to leaderboard." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid score payload." }, { status: 400 });
  }

  const { chartId, score, accuracy, maxCombo } = parsed.data;
  const chartResult = await sql`SELECT chart_json FROM sh_charts WHERE id = ${chartId} LIMIT 1`;
  const chart = (chartResult.rows[0] as { chart_json: Chart } | undefined)?.chart_json;
  if (!chart) {
    return NextResponse.json({ error: "Chart not found." }, { status: 404 });
  }
  if (score > maxPossibleScore(chart) || maxCombo > chart.notes.length) {
    return NextResponse.json({ error: "Score rejected by anti-cheat validation." }, { status: 400 });
  }

  await sql`
    INSERT INTO sh_chart_scores (player_id, chart_id, score, accuracy, max_combo)
    VALUES (${player.id}, ${chartId}, ${score}, ${accuracy}, ${maxCombo})
    ON CONFLICT (player_id, chart_id)
    DO UPDATE SET
      score = GREATEST(sh_chart_scores.score, EXCLUDED.score),
      accuracy = CASE WHEN EXCLUDED.score >= sh_chart_scores.score THEN EXCLUDED.accuracy ELSE sh_chart_scores.accuracy END,
      max_combo = GREATEST(sh_chart_scores.max_combo, EXCLUDED.max_combo),
      created_at = CASE WHEN EXCLUDED.score >= sh_chart_scores.score THEN NOW() ELSE sh_chart_scores.created_at END
  `;
  return NextResponse.json({ ok: true });
}

/** Every note perfect at the top x8 multiplier, every hold tick too: a ceiling, not an estimate. */
function maxPossibleScore(chart: Chart): number {
  let total = 0;
  for (const note of chart.notes) {
    total += 1000 * 8;
    if (note.durationMs > 0) total += holdCheckpointTimes(note).length * HOLD_TICK_BASE_POINTS * 8;
  }
  return total;
}
