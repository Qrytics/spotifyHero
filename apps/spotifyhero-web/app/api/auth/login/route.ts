import { NextResponse } from "next/server";
import { z } from "zod";
import { checkPassword, issueSession } from "@/lib/auth";
import { ensureSchema, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  await ensureSchema();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid login payload." }, { status: 400 });
  }

  const { rows } =
    await sql`SELECT id, email, display_name, password_hash FROM sh_players WHERE email = ${parsed.data.email.toLowerCase()} LIMIT 1`;
  const row = rows[0] as
    | { id: string; email: string; display_name: string; password_hash: string }
    | undefined;
  if (!row) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
  const ok = await checkPassword(parsed.data.password, row.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
  await issueSession({ id: row.id, email: row.email, displayName: row.display_name });
  return NextResponse.json({
    player: { id: row.id, email: row.email, displayName: row.display_name },
  });
}
