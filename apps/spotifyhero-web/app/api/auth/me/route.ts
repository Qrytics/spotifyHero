import { NextResponse } from "next/server";
import { getSessionPlayer } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSchema();
  const player = await getSessionPlayer();
  return NextResponse.json({ player });
}
