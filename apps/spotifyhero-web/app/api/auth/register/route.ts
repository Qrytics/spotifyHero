import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSchema, sql } from "@/lib/db";
import { hashPassword, issueSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(2).max(24),
});

export async function POST(req: Request) {
  await ensureSchema();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid register payload." }, { status: 400 });
  }
  const { email, password, displayName } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    const { rows } = await sql`
      INSERT INTO sh_players (email, display_name, password_hash)
      VALUES (${email.toLowerCase()}, ${displayName}, ${passwordHash})
      RETURNING id, email, display_name
    `;
    const row = rows[0] as { id: string; email: string; display_name: string };
    await issueSession({ id: row.id, email: row.email, displayName: row.display_name });
    return NextResponse.json({
      player: { id: row.id, email: row.email, displayName: row.display_name },
    });
  } catch {
    return NextResponse.json({ error: "Email already registered." }, { status: 409 });
  }
}
