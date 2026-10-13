import { NextResponse } from "next/server";
import { getSessionPlayer } from "@/lib/auth";
import { ensureSchema, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  // `accounts: false` tells the client to hide sign-in rather than offer a form that can't work.
  if (!hasDatabase()) return NextResponse.json({ player: null, accounts: false });
  await ensureSchema();
  const player = await getSessionPlayer();
  return NextResponse.json({ player, accounts: true });
}
